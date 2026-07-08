# Decisions Log

Design decisions resolved while turning the original `Sheep, Wolves & Grass.md`
into an implementable spec. Numbering follows the flaws/questions raised during
review. See [SPEC.md](./SPEC.md) for the resulting specification and
[TODO.md](./TODO.md) for questions still open.

## Resolved

1. **Round end.** Round ends when **at most one** sheep remains alive. *(Amended
   2026-07-03: check is ≤ 1, not exactly 1 — two wolves can eat the last two sheep
   in the same tick.)* The sole survivor, if any, has no possible predator.
2. **Same-target tick conflict.** *(Refined by #23.)* If multiple entities of the
   **same type** try to enter the same cell in one tick, a random winner moves; the
   others hold. A sheep/wolf contest is deterministic under the phase model: the
   sheep arrives first (phase c) and the wolf eats it (phase d).
3. **Move rate.** At most one command per entity per tick; holding a key gives
   continuous movement (client repeats, server applies ≤1 per tick). *(Amended
   2026-07-08 by #34: the limit is one command per **player** per tick.)*
4. **Slip-past.** A sheep may pass a wolf on a same-tick cell swap (no eat).
   *(Now a consequence of the #23 phase order, not a separate rule.)*
5. **Screens.** Hold screen removed — only start + play screens.
6. **Chess activation.** Activates when voted share ≥ `cfgChessVoteThreshold`;
   default 100% (all). Not voting = a vote against. *(Amended 2026-07-08 by
   #35: the share is measured over **humans** only.)*
7. **Chess turn timeout.** Per-turn timeout required (`cfgChessTurnTimeout`);
   turn advances with whatever inputs arrived, missing players don't move.
8. **Chess grass growth.** Grows per `cfgChessTicksPerGrassGrow` ticks (not
   wall-clock). Future: randomize the interval.
11. **Exit / sheep loss.** On exit (`E`) or losing its sheep, a player's sheep is
    removed (no points awarded; still counts toward the "one sheep left" end
    check); their wolf becomes a lonely wolf.
12–13. **Disconnect / refresh.** A disconnect or browser refresh = the player
    leaves; a reload creates a brand-new player (no session-token reclaim in v1).
14. **Lobby.** Single global lobby per server.
15. **Stats.** Player stats are in-memory only (reset on server restart).
16. **Cell occupancy invariant.** At the end of every tick, every cell holds at
    most one thing — grass, a sheep, or a wolf *(amended 2026-07-03 by #23 and
    #25)*. Sheep/foreign-wolf co-location can occur transiently *within* a tick
    and is resolved by the end-of-tick kill sweep, so it is never rendered.
    Nothing is ever hidden beneath a creature; rendering needs no priority rules.
9. **Auto-start timer.** The `cfgStartTimeout` countdown starts when the first
   player presses `P` (ready) and **resets whenever a new player joins**, so
   newcomers always get time to ready up.
10. **Ready is final.** Pressing `P` is irreversible — a player cannot return to
    'waiting'. (Simpler state machine; combined with #9, joins extend the window
    rather than letting players toggle in and out.)
17. **Round-start placement.** Wolf+sheep pairs are placed to **maximize the
    minimum pairwise distance** between pairs (corners for 2/4 players, evenly
    distributed otherwise), never overlapping grass or each other.
18. **Field bounds.** Solid walls, no wrap-around; a move into a wall is a no-op.
19. **Field size semantics.** `cfgFieldSizeX/Y` measure the **playable interior**;
    the border box and scoreboard are drawn outside it, so total rendered size
    exceeds the configured numbers.
20. **Config typo.** `cfgMayNofPlayers` → `cfgMaxNofPlayers`.
21. **Player colors.** Colorblind-safe palette (Okabe-Ito based, extended to 10).
    A player's sheep and wolf share the player's color, distinguished by letter
    case. Values live in `cfgColors` and are tunable. Default set:

    | # | Name           | Hex     |
    |---|----------------|---------|
    | 1 | Orange         | #E69F00 |
    | 2 | Sky blue       | #56B4E9 |
    | 3 | Bluish green   | #009E73 |
    | 4 | Yellow         | #F0E442 |
    | 5 | Blue           | #0072B2 |
    | 6 | Vermillion     | #D55E00 |
    | 7 | Reddish purple | #CC79A7 |
    | 8 | White          | #FFFFFF |
    | 9 | Grey           | #999999 |
    | 10| Cyan           | #33CCCC |

    (#1–#7 are the Okabe-Ito hues; #8 white replaces Okabe-Ito black for a dark
    terminal background; #9–#10 extend the set and are the least strictly
    CB-distinct — tune via `cfgColors` if needed.)
6b. **Bot chess vote.** Bots always vote **against** chess, so a lone human can
    never be forced into chess mode and the 100% default effectively means "all
    humans agree." See [SPEC.md](./SPEC.md) chess mode. *(Superseded 2026-07-08
    by #35: bots are not part of the electorate at all.)*
22. **Configuration model.** Single flat JSON file (`shared/config.default.json`)
    is the source of truth; one shared `shared/` schema validates every surface.
    Precedence: file → env vars → REST config API → query params. Each param has a
    mutability class (live / next-round / startup-only). Because the world is
    server-authoritative with one global lobby (#14), any override is global, not
    per-client. Query-param overrides are honored **only** when the startup-only
    `cfgAllowClientOverrides` flag is on (off in production, so a crafted URL can't
    retune a live server); the flag itself can't be set via query param. Full
    parameter table and resolution rules in [SPEC.md](./SPEC.md) → Configuration.
23. **Tick phase model & unified kill rule** *(2026-07-03)*. Each tick: **(a)**
    collect input (≤1 command per entity); **(b)** validate — walls, own entities,
    and same-type entities are invalid targets, so the only permitted collisions
    are wolf→foreign sheep and sheep→foreign wolf; **(c)** move all sheep, eat
    grass; **(d)** move all wolves; **(e)** kill sweep — every sheep sharing a
    cell with another player's wolf is eaten, regardless of who moved onto whom
    (the wolf's owner scores `cfgSheepKillBonus`; lonely wolves included, which
    subsumes the former separate lonely-wolf eat rule) — then the round-end check
    (≤ 1 sheep). Ticks therefore always end with at most one entity per cell.
    Refines #2 (random winner only among same-type movers; a sheep/wolf contest
    is deterministic — the sheep arrives first, the sweep kills it), makes #4
    emergent (a swap leaves no co-location at sweep time; likewise a wolf moving
    away spares a sheep that stepped onto it), amends #16. *(Phase (a) amended
    2026-07-08 by #34: ≤1 command per player, not per entity.)*
24. **Chess turn input** *(2026-07-03)*. One move for one entity (sheep **or**
    wolf) per player per turn; a move against a wall is a legal pass. Knocked-out
    and exited players have nothing to move and are excluded from the all-inputs
    wait (otherwise the turn could never advance).
25. **Wolves trample grass** *(2026-07-03)*. A wolf landing on grass destroys it —
    it vanishes, nobody scores. Together with sheep eating grass on arrival, this
    makes the occupancy invariant (#16) total: there is no "grass hidden under a
    creature" state to track or restore on departure. Consequences: grass growth
    targets only empty cells (a spawn with no empty cell available is skipped),
    and a wolf can deliberately deny grazing points by trampling — an intended
    strategic option.
26. **Minimum players** *(2026-07-07)*. `cfgMaxNofPlayers` lower bound raised
    1 → 2. A round needs two sheep to be non-degenerate, but the minimum number
    of *human* players stays 1: a lone human plays against a bot (auto-added on
    start-timeout if nobody else joined), so the cap must always leave room for
    that second, possibly artificial, player.
27. **Cross-parameter validation** *(2026-07-07)*. Constraints spanning several
    params — `cfgColors.length ≥ cfgMaxNofPlayers`,
    `cfgInitialNofGrass ≤ cfgMaxNofGrass`, and
    `cfgInitialNofGrass + 2 × cfgMaxNofPlayers ≤ interior cells` (grass plus all
    wolf+sheep pairs must fit the field) — are enforced by the shared validator
    on every config change, alongside the per-key bounds. A runtime change that
    would violate one is **rejected** and the last valid config kept (same
    semantics as a per-key failure); a default file that violates one is a fatal
    startup error. This also closes the `cfgMaxNofPlayers` (live) vs `cfgColors`
    (next-round) mutability gap: raising the player cap beyond the palette
    length is simply rejected.
28. **Placement orientation fallback** *(2026-07-08)*. Pairs are placed as
    wolf with sheep to its **right**; if that cell is a wall (right-edge
    placements), the sheep **mirrors to the wolf's left** instead. Deterministic
    and total: field width ≥ 10 guarantees one horizontal neighbor is inside,
    and the placement algorithm keeps both pair cells clear of grass and other
    pairs, so no further fallback is needed.
    *(Amended 2026-07-08: "maximize the minimum pairwise distance" (#17) is a
    heuristic goal, not a strict optimum — corners are prescribed for 2/4
    players, other counts spread greedily farthest-point; anything clearly
    better than random placement suffices.)*
29. **Countdown & round-start gating** *(2026-07-08)*. The `cfgStartTimeout`
    countdown starts when the first **human** readies, and only **human** joins
    reset it — bots are 'ready' the instant they are added and need no ready-up
    time, so adding one neither starts nor resets the window. A round starts
    when every non-left player is 'ready', there are ≥ 2 players, and at least
    one is human; a lone ready human waits out the countdown, whose elapse
    forces stragglers to 'ready' and auto-adds the bot (#26).
30. **Lobby lifecycle & leavers** *(2026-07-08)*. A player who exits or
    disconnects mid-round stays listed as 'left' until the round ends (their
    lonely wolf still needs the letter and color on screen) and is purged at
    the round boundary; leavers forfeit the round result. Letters, colors and
    bot numbers are reused lowest-free. When the last human leaves, bots are
    removed, a running round is aborted without a result, and the lobby resets
    — bots never play alone. Stats live exactly as long as their player (#15);
    an empty lobby is a fresh game.
31. **Play-screen keys** *(2026-07-08, resolves TODO open question 2)*. During
    a round the only inputs for a playing player are movement and `E` (exit,
    per #11). `P`, `B`, `C` and name editing are start-screen actions — they
    remain available to players *on* the start screen (e.g. mid-round joiners)
    while a round runs elsewhere.
32. **Chess ballot handling** *(2026-07-08)*. `C` toggles the player's vote.
    The tally (voted share vs `cfgChessVoteThreshold`, non-voting humans count
    against, bots not at all — #35) is shown continuously on the start screen
    and **consumed at round start**: all ballots reset to 'against', so each
    round is voted on afresh.
33. **Startup vs runtime config failures** *(2026-07-08)*. Invalid `cfg*` env
    vars are **fatal at boot** (like a bad default file — fail where the
    operator sees it), while runtime changes (REST PATCH, query params) are
    rejected per key with the last valid config kept. A PATCH reports
    `{applied, pending, rejected}`; a cross-param violation rejects the whole
    accepted set, checked both against the immediate config (live keys) and
    the next-round view (live + buffered keys). Process-level settings that
    are not game parameters — `PORT` (default 8080) and `STATIC_DIR` — are
    plain env vars, not `cfg*` keys.
34. **One move per player per tick & bot speed throttle** *(2026-07-08)*.
    Replaces the per-entity allowance (#3, #23 phase a): each tick a player
    moves either their sheep **or** their wolf — the newest command wins. This
    simplifies the rules, unifies real-time and chess input (#24 was already
    one-per-player), and removes the bots' superhuman both-entities-at-once
    play that made them unbeatable. Bots are additionally throttled by
    `cfgBotSpeedThrottle`, the **idle-to-move tick ratio**
    (`total ticks / moving ticks − 1`): 0 = a move every tick, 1 = half speed,
    3 = quarter speed; fractions allowed, linear in the ratio (unlike an
    every-Nth-tick divider). Implemented as a per-bot credit accumulator
    (+`1/(1+throttle)` per tick, a full credit buys one move); humans are
    never throttled. With one move per tick a bot must split attention:
    flee a close wolf first, otherwise alternate hunting and grazing.
35. **Chess electorate is humans only** *(2026-07-08, supersedes #6b)*. Bots
    take no part in the chess vote: they neither vote nor count in the
    denominator. The share is `voting humans / present (non-left) humans`,
    compared against `cfgChessVoteThreshold`; with zero humans there is no
    chess (moot — bots never play alone, #30). Consequence: a lone human
    playing against a bot can now activate chess at the default 100%
    threshold, which #6b's implicit bot-against vote made impossible.

---

*Assisted-by: Claude (Anthropic)*
