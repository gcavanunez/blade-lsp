# Effect migration roadmap (blade-lsp)

Process modeled on opencode's Effect migration: small vertical slices,
public wire shapes preserved, tests migrated when touched, Promise facades
deleted (not stacked) once a subsystem is Effect-native.

Status legend: `[ ]` pending, `[~]` in progress, `[x]` done.

## Checklist for every slice

- Single Effect body instead of Promise wrappers inside the slice.
- Expected failures are typed errors in the error channel; defects stay defects.
- Layer requirements are explicit; no hidden provisioning.
- One contiguous `runPromise` block at each Promise boundary.
- Tests updated alongside the code; no `sleep`-as-synchronization.

## Track RT — runtime port to Effect v4 (this branch)

- [x] RT1: bump `effect` 3.19 → `4.0.0-beta.93` (exact pin).
- [x] RT2: `tsconfig` `module`/`moduleResolution` → `NodeNext`; rely on Node
      `require(esm)` (engines bumped to `>=20.19.0`).
- [x] RT3: `Context.Tag(...)` → `Context.Service<Self, Shape>()(key)` for all
      14 service keys (`src/runtime/services.ts`).
- [x] RT4: `Effect.async` → `Effect.callback` (`src/laravel/php-runner.ts`).
- [x] RT5: typecheck, full test suite, build + dist smoke test.

## Track LOCK — replace hand-rolled concurrency

- [x] LOCK1: `LaravelInitPromiseService` (`MutableRef<Promise<boolean> | null>`
      mutex in `src/laravel/index.ts`) → `Semaphore` (single permit) +
      idempotence check on `LaravelContext.isAvailable()`. Concurrent callers
      queue on the permit and coalesce; failed runs leave no context so
      retries re-boot. Service key replaced by `LaravelInitLockService`.
      (Note: `Effect.cached` was considered but its arg-less, result-caching
      shape didn't fit per-call `workspaceRoot`/`options`.)
- [x] LOCK2: `src/utils/lock.ts` RW lock deleted. Its only consumers were the
      three refresh modules, and only `Lock.write` — the entire read side was
      dead code. Each module now owns a module-level single-permit
      `Semaphore` held via `Semaphore.withPermit`.
- [x] LOCK3: `src/utils/defer.ts` deleted. Its only consumer was
      `Log.withLevel` (pure-sync level restore), which is now a plain
      try/finally — no Effect needed for a synchronous spot.

## Track RUNNER — push the Effect boundary up

- [x] RUN1: `PhpRunner.runScript` returns `Effect<T, RunScriptError>` (no
      internal `runPromise`); manual `setTimeout` replaced with
      `Effect.timeoutOrElse` (interruption drives SIGTERM via the abort
      signal).
- [x] RUN2: `views/components/directives.refresh` return
      `Effect<void, RefreshError>`; lock held via `Effect.acquireUseRelease`,
      failed load state recorded with `Effect.tapError` + `Effect.mapError`.
- [x] RUN3: `Laravel.refreshAll` composes with `Effect.all` in
      `{ mode: 'result' }` (v4 replaced Either-mode with `Result`); the
      watcher debounce in `server.ts` runs one contiguous
      `Effect.all` block. Promise boundary stays at `refreshAll` /
      the watcher callback.

## Track BRIDGE — php-bridge lifecycle (highest correctness payoff)

Sliced plan (each independently shippable; see the lifecycle map in this
track's history):

- [x] BR0: extract the readiness state machine into a **pure reducer**
      (`src/providers/php-bridge/readiness.ts`, `Readiness.reduce`), with
      direct unit tests (`tests/unit/php-bridge-readiness.test.ts` — the
      machine previously had zero non-e2e coverage). `backend.ts` keeps a
      thin `dispatchReadiness` that applies the reducer and flushes ready
      callbacks when the state settles. No behavior change.
- [ ] BR1: `bridge.ts` `ensureBackend`/`BackendLifecycle` → cached scoped
      acquisition (`Effect.cached`-style single-flight with reset-on-null,
      matching the "retry after startup failure" unit test); exported
      Promise API unchanged.
- [ ] BR2: `backend.ts` `startSession`/`shutdownSession` →
      `Effect.acquireRelease` (spawn/handshake acquire, best-effort
      shutdown→kill→dispose release); readiness callbacks → `Deferred`;
      `waitForReady` → `Deferred.await` + `Effect.timeout` + the 2s grace
      heuristic. Prereq: fake-process/connection-injection unit tests for
      the backend lifecycle.
- [ ] BR3: `ensureStarted`/`shutdown` `while(true)` CAS loops →
      `Semaphore(1)`-guarded lifecycle (pattern already used by
      `LaravelInitLockService`); decide explicitly whether to add a
      dead-process scope watcher (behavior improvement, currently no
      recovery and no test pins it).
- [ ] BR4: `syncDocument` side-effect block per-URI semaphore;
      `getCompletion` eager resolve `Promise.all` → `Effect.forEach`;
      diagnostics callback arrays → scoped subscription (fixes the
      never-cleared callbacks and the `server.ts` `getPhpBridgeState`
      abandoned-state leak).

## Track LAYER — make layers real

- [x] LAY1 (decided: **won't do**): parser init stays at the LSP `initialize`
      handshake, not in a `Layer.effect`. Rationale: (a) parser failure is
      deliberately tolerated — the server keeps running in degraded mode
      (`server.ts` onInitialize catch); a failing layer would abort startup
      instead. (b) The WASM runtime exposes no disposal API, so there is no
      finalizer to own. (c) WASM init is async, and layer extraction is
      `runSync` — an async layer would force `Container.build()` async for
      no lifecycle gain.
- [x] LAY2: an internally-created stdio connection is now owned by the
      runtime via `Layer.effect` + `Effect.acquireRelease`; its `dispose()`
      runs on `Container.dispose()` (shutdown and per-test reset). External
      test connections stay `Layer.succeed` — the caller owns them.
      `TextDocuments`/`Progress` have no teardown APIs; nothing to own.
- [x] LAY3 (decided): keep the extracted `Container.Services` singleton for
      pure/sync call sites. Effect-native subsystems compose as Effects and
      run via `runPromise` at explicit edges (see RUN3). Do not force
      handlers into the runtime wholesale.

## Track ERR — unify errors

- [x] ERR1: new Effect-native surfaces use `Schema.TaggedErrorClass`
      (policy; see `docs/effect/guide.md`).
- [x] ERR2: all eight `PhpRunner` errors migrated from zod `NamedError` →
      `Schema.TaggedErrorClass`. Fields are top-level (no `.data`);
      `ScriptNotFoundError`/`TimeoutError` define `message` getters (the
      other six have a `message` field). `ErrorFormat.toObject` reconstructs
      the `{ name, data }` logging shape from `_tag` + own fields, so the
      structured-log format is unchanged. `Effect.catchTag` now works on the
      `runScript` error channel.
- [x] ERR3: all remaining `NamedError` classes migrated —
      `Views/Components/Directives.RefreshError` (with a
      `cause: Schema.optional(Schema.Unknown)` field carrying the underlying
      error; `Schema.Defect` crashes in beta.93), `Laravel.*` errors,
      `Container.NotInitializedError`, `BladeParser.NotInitializedError`,
      and `NamedError.Unknown` → `UnknownError`. The zod `NamedError`
      factory is gone; `utils/error.ts` now only hosts `UnknownError`.
- [x] SCHEMA (bonus): LSP settings parsing in `server.ts` migrated from zod
      `looseObject`/`safeParse` to Effect `Schema.Struct` +
      `Schema.decodeUnknownOption`. **zod removed from dependencies.**

## Track TEST — Effect-aware testing

- [x] TST1: `tests/utils/effect.ts` adds `runTest(effect)` — typed failures
      are rethrown as-is (so `rejects`/`instanceof` assertions work), defects
      throw with the pretty-printed `Cause`. Used by
      `tests/unit/php-runner.test.ts` (catchTag, top-level error fields) and
      `tests/unit/refresh.test.ts` (RefreshError cause chain, load-state
      recording).
- [ ] TST2: replace stub-container setup in `tests/utils/laravel-mock.ts`
      with test layers where slices are migrated.
- [ ] TST3: enforce no-sleep synchronization (readiness signals only).

## Out of scope

- Pure providers/parser (`src/providers/*` except php-bridge lifecycle,
  `src/parser/*`) stay plain TypeScript.
- No ESM output migration; CJS emit + `require(esm)` is the supported shape.
- No `export namespace` → flat-module rewrite (opencode does this; we keep
  our documented namespace convention).

## Reference material

- opencode playbook (local checkout): `~/_code/gcavanunez/opencode`
    - `.opencode/skills/effect/SKILL.md`
    - `packages/opencode/specs/effect/{guide,migration,todo,errors,facades}.md`
    - `packages/opencode/AGENTS.md` ("opencode Effect rules")
- effect-smol source of truth: clone into `.agents/resources/effect-smol`
  (see `.opencode/skills/effect/SKILL.md`).
