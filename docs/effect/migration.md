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
- [ ] LOCK3: `src/utils/defer.ts` → `Scope`/`Effect.addFinalizer` at Effect
      boundaries; keep `using` for pure-sync spots.

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

- [ ] BR1: `backend.ts` `ClientState`/`ReadinessState` machines →
      `Scope` + `Effect.acquireRelease` for the PHP LSP child process;
      `Deferred` for readiness; delete callback registries.
- [ ] BR2: `bridge.ts` `BackendLifecycle` (promises stored in state) →
      scoped resource + `Effect.cached` acquisition.
- [ ] BR3: indexing progress / background loops → `Effect.forkIn(scope)` +
      `Effect.repeat`; interruption instead of manual cancellation flags.
- [ ] BR4: diagnostics callback array → Effect stream or queue (evaluate).

## Track LAYER — make layers real

- [ ] LAY1: parser init (`ParserApi.initialize`) → `Layer.effect` so the
      runtime owns WASM initialization; drop `ParserRuntimeService` null ref.
- [ ] LAY2: connection/documents wiring as scoped layers with finalizers so
      `Container.dispose()` releases real resources.
- [ ] LAY3 (decision): keep the extracted `Container.Services` singleton for
      pure call sites, but run Effect-native subsystems via
      `runtime.runPromise` instead of extracting them.

## Track ERR — unify errors

- [ ] ERR1: new Effect-native surfaces use `Schema.TaggedErrorClass`.
- [ ] ERR2: migrate `PhpRunner` errors from zod `NamedError` →
      `Schema.TaggedErrorClass`; adopt `Effect.catchTag` in callers.
- [ ] ERR3 (later): evaluate replacing `src/utils/error.ts` wholesale once
      most consumers are Effect-native.

## Track TEST — Effect-aware testing

- [ ] TST1: add a `testEffect` helper (vitest) that builds explicit test
      layers and pretty-prints `Cause` on failure.
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
