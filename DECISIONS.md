# Decisions Log

Design decisions resolved while turning the original `Sheep, Wolves & Grass.md`
into an implementable spec. Numbering follows the flaws/questions raised during
review. See [SPEC.md](./SPEC.md) for the resulting specification and
[TODO.md](./TODO.md) for questions still open.

## Resolved

1. **Round end.** Round ends when only one sheep remains alive (last-but-one
   eaten). Guarantees termination — the sole survivor has no possible predator.
2. **Same-target tick conflict.** If multiple entities try to enter the same cell
   in one tick, a random winner moves; the others hold for that tick.
3. **Move rate.** At most one command per entity per tick; holding a key gives
   continuous movement (client repeats, server applies ≤1 per tick).
4. **Slip-past.** A sheep may pass a wolf on a same-tick cell swap (no eat).
5. **Screens.** Hold screen removed — only start + play screens.
6. **Chess activation.** Activates when voted share ≥ `cfgChessVoteThreshold`;
   default 100% (all). Not voting = a vote against.
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
16. **Cell occupancy invariant.** Two entities can **never** share a cell — the
    same-target conflict rule (#2), the slip-past swap (#4), and eat-removes-the-sheep
    together guarantee it. Rendering therefore needs no entity-vs-entity priority;
    the only rule is that an entity hides any grass beneath it.
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
    humans agree." See [SPEC.md](./SPEC.md) chess mode.
22. **Configuration model.** Single flat JSON file (`shared/config.default.json`)
    is the source of truth; one shared `shared/` schema validates every surface.
    Precedence: file → env vars → REST config API → query params. Each param has a
    mutability class (live / next-round / startup-only). Because the world is
    server-authoritative with one global lobby (#14), any override is global, not
    per-client. Query-param overrides are honored **only** when the startup-only
    `cfgAllowClientOverrides` flag is on (off in production, so a crafted URL can't
    retune a live server); the flag itself can't be set via query param. Full
    parameter table and resolution rules in [SPEC.md](./SPEC.md) → Configuration.

---

*Assisted-by: Claude (Anthropic)*
