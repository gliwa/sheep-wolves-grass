# TODO — Work Breakdown & Open Questions

See [SPEC.md](./SPEC.md) for the specification and [DECISIONS.md](./DECISIONS.md)
for resolved design choices.

## Open questions
Smaller issues from the 2026-07-03 spec review, deferred for later. (The larger
rule gaps from that review — sheep/wolf co-location, round-end check, tick phase
order, chess-move semantics — are resolved in [SPEC.md](./SPEC.md) /
[DECISIONS.md](./DECISIONS.md). The former questions on the `cfgMaxNofPlayers`
lower bound and on cross-parameter validation were resolved 2026-07-07 →
[DECISIONS.md](./DECISIONS.md) #26/#27. The former question on placement
orientation was resolved 2026-07-08 → [DECISIONS.md](./DECISIONS.md) #28.)

2. **Play-screen keys** — only movement keys are specified; is `E` (exit) available
   mid-round? DECISIONS #11 implies yes.
3. **Round termination** — "one sheep left" guarantees the end state is *reachable*,
   not that rounds end: two cautious players can graze forever. Accept by design
   (note it in SPEC) or add a round timeout?

## Work Breakdown Structure (WBS)
1. ✅ **Setup/infra** — monorepo scaffold, TS build, dev reload, lint/format, README/LICENSE
   *(done 2026-07-03: npm workspaces `shared`/`server`/`client`, strict TS, esbuild
   bundles, tsx watch, ESLint 9 + Prettier, vitest, MIT license)*
2. ✅ **Shared model & protocol** — config schema, game-state model, play-API messages,
   state machines, pure rules module
   *(done 2026-07-07: `shared/config.default.json` + validated schema with per-key
   bounds, mutability classes, cross-param checks and string parsing; JSON-serializable
   game-state model with player-status transitions; WS protocol types +
   `parseClientMessage`; pure `resolveTick` (phase model), `growGrass`,
   `applyPlayerExit` with injectable rng; 39 vitest tests)*
3. ✅ **Server engine** — field/entities, placement, movement & random-conflict resolution,
   scoring, grass growth (real-time + chess), round lifecycle (one-sheep-left end), tick loop
   *(done 2026-07-08: `server/src/engine/` — placement (corners for 2/4, greedy
   farthest-point otherwise, #28 mirror fallback, random seating, initial grass);
   `RoundEngine` (command buffer, next-round config snapshot vs live reads,
   real-time grass accumulator + chess tick cadence, exit, round result);
   `TickLoop` (live `cfgTickMs`, drift compensation, `0` = free-run via
   setImmediate); 24 new vitest tests, 63 total)*
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
