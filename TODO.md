# TODO — Work Breakdown & Open Questions

See [SPEC.md](./SPEC.md) for the specification and [DECISIONS.md](./DECISIONS.md)
for resolved design choices.

## Open questions
Smaller issues from the 2026-07-03 spec review, deferred for later. (The larger
rule gaps from that review — sheep/wolf co-location, round-end check, tick phase
order, chess-move semantics — are resolved in [SPEC.md](./SPEC.md) /
[DECISIONS.md](./DECISIONS.md).) None of these block WBS item 1.

1. **`cfgMaxNofPlayers` lower bound** — currently 1, but a 1-player round starts
   with a single sheep and would end immediately, and the auto-add-bot rule needs
   room for a second player. Raise the minimum to 2?
2. **Placement orientation** — "wolf, sheep to its right" puts the sheep inside the
   wall when a pair sits at a right-edge corner; define an orientation fallback.
3. **Cross-parameter validation** — `cfgMaxNofPlayers` is *live* but `cfgColors`
   (length ≥ max players) is *next-round*, so raising the cap mid-round can break
   the constraint. Also define behavior (clamp or reject) for
   `cfgInitialNofGrass > cfgMaxNofGrass` and for
   `cfgInitialNofGrass + 2 × players > interior cells`.
4. **Play-screen keys** — only movement keys are specified; is `E` (exit) available
   mid-round? DECISIONS #11 implies yes.
5. **Round termination** — "one sheep left" guarantees the end state is *reachable*,
   not that rounds end: two cautious players can graze forever. Accept by design
   (note it in SPEC) or add a round timeout?

## Work Breakdown Structure (WBS)
1. ✅ **Setup/infra** — monorepo scaffold, TS build, dev reload, lint/format, README/LICENSE
   *(done 2026-07-03: npm workspaces `shared`/`server`/`client`, strict TS, esbuild
   bundles, tsx watch, ESLint 9 + Prettier, vitest, MIT license)*
2. **Shared model & protocol** — config schema, game-state model, play-API messages,
   state machines, pure rules module
3. **Server engine** — field/entities, placement, movement & random-conflict resolution,
   scoring, grass growth (real-time + chess), round lifecycle (one-sheep-left end), tick loop
4. **Server lobby/session** — join+color, name edit, ready flow + timeout, bots,
   round-end stats, game end, reconnection/identity
5. **Server networking** — WebSocket play API, config REST API, static serving
6. **Client** — screen-mode framework (start/play), ASCII field + scoreboard render,
   start-screen table + name edit, keyboard input, WS client, latency handling
7. **Chess mode** — voting UI + threshold, await-all-inputs turn logic + timeout,
   per-tick grass growth, mode selection
8. **Testing** — unit rules tests, headless play-API clients, integration full-round, latency smoke
9. **Deploy/ops** — prod build, systemd + nginx (`wss`), config persistence, GitHub polish
10. **LLM optimization** — OUT OF SCOPE for now (final phase): LLM players via play API,
    parameter-tuning loop via config API, balance metric

## Future ideas (not scheduled)
- **Player-facing game-settings screen** — expose a curated subset of `cfg*` params
  (the taste-based ones) to regular players through the validated config surface.
  Config is developer-only for now; see [SPEC.md](./SPEC.md) → Configuration.

## Verification (to detail once scope locks)
- Unit tests on the pure rules module (`shared/`).
- Two headless play-API clients auto-complete a full round.
- Manual browser playtest against the local server.

---

*Assisted-by: Claude (Anthropic)*
