# TODO — Work Breakdown & Open Questions

See [SPEC.md](./SPEC.md) for the specification and [DECISIONS.md](./DECISIONS.md)
for resolved design choices.

## Open questions
**None** — all resolved. The spec is locked; see [DECISIONS.md](./DECISIONS.md)
for the full rationale (#1–#21, #6b). Ready to start on WBS item 1.

## Work Breakdown Structure (WBS)
1. **Setup/infra** — monorepo scaffold, TS build, dev reload, lint/format, README/LICENSE
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
