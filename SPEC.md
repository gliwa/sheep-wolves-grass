# Sheep, Wolves & Grass — Specification

Browser-based, multiplayer (1–10), real-time ASCII game. Server-authoritative
game loop, WebSocket "play API", REST "config API" for tunable `cfg*` params,
bots, optional turn-based "chess mode", and (final, out-of-scope-for-now) an
LLM "game optimization" harness.

Author goals: **learn AI-assisted development** while building, and **ship it**
(open-source on GitHub + self-hosted playable on the author's web server).

See [DECISIONS.md](./DECISIONS.md) for the rationale behind resolved design
choices, and [TODO.md](./TODO.md) for the work breakdown and remaining open
questions.

---

## Stack decision (locked)
- **Node.js + TypeScript**, single monorepo: `shared/` (protocol + config types +
  pure game rules), `server/` (engine, lobby, networking), `client/` (render + input).
- **Play API:** WebSockets (`ws`), server-authoritative simulation tick.
- **Config API + static hosting:** small HTTP layer (Fastify or `node:http`).
- **Client:** vanilla TS, ASCII into a `<pre>` with per-cell color; esbuild/Vite bundle.
- **Deploy:** one Node process + systemd + nginx (TLS → `wss`).
- **LLM phase (later):** Anthropic SDK; LLM plays via the play API, tunes via config API.

---

## Game specification

### Entities & field
- Rectangular field `cfgFieldSizeX` × `cfgFieldSizeY`, measured as the **playable
  interior**; the border box and scoreboard are rendered outside it. Solid walls,
  no wrap-around — a move into a wall is a no-op.
- Sheep = lowercase letter, wolf = uppercase letter, per player (a/A, b/B, …).
  Each player has an individual color (sheep and wolf share it, distinguished by
  case); palette in `cfgColors`. Grass = `,`.
- **Occupancy invariant:** at the end of every tick, every cell holds **at most
  one thing** — grass, a sheep, or a wolf. Sheep eat grass they land on, wolves
  **trample** it (see Eating & scoring), so nothing is ever hidden beneath a
  creature. Sheep/foreign-wolf co-location can occur transiently *within* a tick,
  but the end-of-tick kill sweep (see tick phases below) resolves it before
  anything is rendered. Rendering therefore needs no priority rules at all.

### Movement & tick resolution
- Sheep moves with cursor keys; wolf with Shift+cursor. A user moves only one at a time.
- **At most one move command per entity per tick.** Holding a key produces
  continuous movement (client repeats the command; server applies ≤1 per tick).
- **Each tick runs in fixed phases** (in chess mode a turn is one tick):
  - **(a) Collect input** (≤1 command per entity).
  - **(b) Validate:** a move is rejected (no-op) if its target — positions as of
    tick start — is a wall, one of the player's **own** entities, or a **same-type**
    entity (sheep→any sheep, wolf→any wolf). The only permitted collisions are
    wolf→foreign sheep and sheep→foreign wolf, both resolved by the kill sweep (e).
  - **(c) Move all sheep;** a sheep landing on grass eats it (+1 point). If several
    sheep target the same cell, a **random** one moves; the others hold.
  - **(d) Move all wolves;** a wolf landing on grass **tramples** it (the grass
    vanishes, nobody scores). Same random-winner rule among wolves contesting one
    cell.
  - **(e) Kill sweep:** every sheep now sharing a cell with another player's wolf
    is eaten (see Eating & scoring) — regardless of who moved onto whom. Then the
    round-end check (≤ 1 sheep alive).
- **Consequences of the phase order** (no extra rules needed):
  - *Slip-past:* a sheep steps onto a wolf's cell (c), the wolf steps onto the
    sheep's old cell (d) — at sweep time they have swapped, no kill. Equally, a
    wolf that moves away in (d) spares a sheep that stepped onto it in (c).
  - *Contested cell:* if a sheep and a wolf move into the same empty cell in one
    tick, the sheep arrives first (c), the wolf lands on it (d), the sweep kills
    it (e).
  - Every tick ends with **at most one entity per cell** — co-location exists only
    transiently between (c) and (e) and is never rendered.

### Eating & scoring
- Sheep onto grass: grass disappears, that player +1 point.
- Wolf onto grass: the grass is **trampled** — it vanishes, nobody scores.
- **Kill rule (one rule covers all cases):** in the end-of-tick kill sweep
  (phase e), any sheep sharing a cell with another player's wolf is eaten — whether
  the wolf moved onto the sheep, the sheep moved onto the wolf, or both moved and
  met. The wolf's owner gains `cfgSheepKillBonus` points and the sheep's player is
  out of the round.
- A wolf can never kill its **own** player's sheep (own entities are invalid move
  targets, phase b).
- When a player's sheep is eaten, that player's wolf remains on the field but is
  **uncontrollable** ("lonely wolf"). The kill rule applies unchanged to lonely
  wolves: a sheep stepping onto one is eaten in that tick's sweep, and the
  knocked-out owner still scores the bonus.

### Round lifecycle
- **Start:** `cfgInitialNofGrass` grass placed at random; each player's wolf+sheep
  placed as an adjacent pair (wolf, sheep to its right), pairs positioned to
  **maximize the minimum pairwise distance** between pairs (corners for 2/4 players,
  evenly distributed otherwise). Initial grass and pairs must not overlap.
- **End:** the round ends once **at most one** sheep remains alive (≤ 1 — two
  wolves can eat the last two sheep in the same tick). The sole survivor, if any,
  has no possible predator. Highest score at that moment wins the round.
- After the round: return to start screen; accumulate each player's rounds+score.
  Bots → 'ready to play', human players → 'waiting for others to join'.

### Grass growth
- **Real-time mode:** grass grows at `cfgGrassGrowRate` commas/minute, capped at
  `cfgMaxNofGrass`.
- **Chess mode:** grass grows once every `cfgChessTicksPerGrassGrow` ticks (not
  wall-clock), capped at `cfgMaxNofGrass`. *(future: randomize, e.g. every 2–6 ticks)*
- New grass appears only on **empty** cells (never beneath a sheep or wolf); if no
  empty cell exists at spawn time, that spawn is skipped, not deferred.

### Screens
- Two screen modes only: **start screen** and **play screen**. (The "hold screen"
  from the original spec is removed.)
- **Start screen:** lists players (position, letter, name, rounds, score, status,
  and — with chess enabled — a Chess vote column). Keys: `Enter` edit name (only
  while 'waiting'), `P` ready, `B` add bot, `E` exit, `C` vote chess. Name edit:
  type in the line under the title, `Enter` to confirm, `Esc` to restore.
- Default player name is `Player <N>`; bots auto-named `Bot1`, `Bot2`, …
  Max players `cfgMaxNofPlayers` (humans + bots combined).
- Pressing `P` (ready) is **irreversible** — a player cannot return to 'waiting'.
- Round starts when all non-left, joined players are 'ready to play'.
- Waiting timeout `cfgStartTimeout`: the countdown **starts when the first player
  readies** and **resets whenever a new player joins**. On elapse all players are
  forced to 'ready'; if only one player is present, a bot is auto-added.

### Chess mode (turn-based variant)
- Players vote with `C`. Chess mode activates for the next round when the share of
  players who voted ≥ `cfgChessVoteThreshold`. Default 100% = **all** players must
  vote. Not voting = a vote **against** chess.
- A player's turn input is **one move for one entity** — either their sheep or
  their wolf. (A move against a wall is legal and acts as a "pass".)
- Turn logic: the field updates only after all **eligible** players' inputs for the
  turn are collected, **or** the per-turn timeout `cfgChessTurnTimeout` elapses —
  then the turn advances with whatever inputs arrived (missing players simply don't
  move that turn). Knocked-out and exited players have nothing to move and are
  excluded from the wait.
- Bots always provide their turn input promptly, and always vote **against** chess
  (a lone human can never be forced into chess mode).

---

## Configuration

### Source of truth
All tunable parameters live in a single flat JSON file, **`shared/config.default.json`**,
keyed by their `cfg*` names. The key name is identical across all three surfaces —
the JSON file, the REST config API field, and the browser query-param name are 1:1
(e.g. `cfgFieldSizeX` everywhere).

A schema in `shared/` (types + bounds) validates the config and is the **single
validator** reused by all three surfaces. Invalid values are rejected and the last
valid value is kept; loading a bad default file is a fatal startup error, a bad
runtime value is logged and ignored (the connection/request still proceeds).

Because the server is authoritative and there is a **single global lobby**
([DECISIONS.md](./DECISIONS.md) #14), config describes one shared world — an override
is never "just for me", it changes the game for everyone.

### Resolution order (lowest → highest precedence)
```
config.default.json  →  env vars  →  REST config API (runtime)  →  query params (dev only)
```
- **REST config API:** `GET /config` returns the current effective config;
  `PATCH /config` sets one or more params (validated, applied per mutability class).
- **Query params:** honored **only when `cfgAllowClientOverrides` is true** (a
  dev-mode flag, `false` in production). When enabled, `?cfgKey=value` on the
  browser connection changes the shared config and applies per mutability class.
  `cfgAllowClientOverrides` is **startup-only** and itself cannot be set via query
  param (env var / file only), so production can't be flipped open remotely.

### Mutability classes
- **live** — the loop reads it directly; a change takes effect immediately (rates,
  caps, tick length, lobby gating).
- **next-round** — buffered and applied at the next round boundary; changing it
  mid-round would be unfair or structurally impossible (field size, scoring,
  round-start counts, chess cadence).
- **startup-only** — read once at process start (`cfgAllowClientOverrides`).

### Parameters
| Key | Type | Unit | Default | Bounds | Mutability |
|-----|------|------|---------|--------|------------|
| `cfgFieldSizeX` | int | cells (interior) | 50 | 10–200 | next-round |
| `cfgFieldSizeY` | int | cells (interior) | 30 | 10–200 | next-round |
| `cfgColors` | string[] | hex CSS colors | 10-color palette (DECISIONS #21) | length ≥ `cfgMaxNofPlayers` | next-round |
| `cfgSheepKillBonus` | int | points | 10 | ≥ 0 | next-round |
| `cfgInitialNofGrass` | int | count | 20 | 0 … interior cells | next-round |
| `cfgGrassGrowRate` | number | commas/min | 20 | ≥ 0 | live |
| `cfgMaxNofGrass` | int | count | 40 | 0 … interior cells | live |
| `cfgStartTimeout` | int | seconds | 60 | ≥ 0 | live |
| `cfgChessVoteThreshold` | int | percent | 100 | 0–100 | next-round |
| `cfgMaxNofPlayers` | int | count | 10 | 2–26 (one letter each) | live |
| `cfgTickMs` | int | ms | 100 | ≥ 0 (0 = uncapped, for optimization) | live |
| `cfgChessTicksPerGrassGrow` | int | ticks | 5 | ≥ 1 | next-round |
| `cfgChessTurnTimeout` | int | seconds | 10 | ≥ 0 | live (from next turn) |
| `cfgAllowClientOverrides` | bool | — | false | — | startup-only |

### Cross-parameter constraints
Beyond per-key bounds, the shared validator enforces constraints that span
several params ([DECISIONS.md](./DECISIONS.md) #27):

- `cfgColors.length ≥ cfgMaxNofPlayers` — every possible player gets a color.
- `cfgInitialNofGrass ≤ cfgMaxNofGrass` — the round can't start above the cap.
- `cfgInitialNofGrass + 2 × cfgMaxNofPlayers ≤ cfgFieldSizeX × cfgFieldSizeY` —
  initial grass plus all wolf+sheep pairs must fit the playable interior.

A runtime change violating any of these is **rejected** (last valid config
kept, same as a per-key bounds failure); a default file violating them is a
fatal startup error.

### Future: player-facing game-settings screen (out of scope for now)
Config tuning is a **developer** concern — regular players have no way to change
`cfg*` values (query overrides are dev-gated, see above). If some parameters later
prove to be a matter of taste (e.g. field size, grass rate, kill bonus), we can add
an optional **"game settings" screen** that exposes a *curated subset* to players,
writing through the same validated config surface. Deferred until a real need
appears; noted here so the config model leaves room for it.

Notes:
- `cfgMaxNofPlayers` renames the original spec's typo `cfgMayNofPlayers`
  ([DECISIONS.md](./DECISIONS.md) #20). Capped at 26 because each player needs a
  distinct letter (a–z); minimum 2 because a round needs two sheep — a lone human
  is paired with a bot ([DECISIONS.md](./DECISIONS.md) #26).
- `cfgTickMs = 0` (or very small) removes tick quantization so the sim runs as fast
  as possible — the mechanism behind the LLM-optimization "disable quantization"
  requirement.
- `cfgColors` must supply at least `cfgMaxNofPlayers` entries; see the palette table
  in [DECISIONS.md](./DECISIONS.md) #21.

---

*Assisted-by: Claude (Anthropic)*
