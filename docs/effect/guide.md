# Effect house style (blade-lsp)

How we write Effect v4 (`effect@4.0.0-beta.x`, the effect-smol rewrite) in this
repo. Patterns adapted from the opencode project's Effect migration playbook.

## Philosophy

Effect is the shell, not the core.

- **Effect owns**: dependency wiring (layers), process/resource lifecycle,
  concurrency (locks, mutexes, readiness), retries, typed error channels for
  I/O boundaries (PHP subprocesses, the embedded PHP LSP bridge, file watchers).
- **Plain TypeScript owns**: everything pure. Providers (`src/providers/*`),
  parser modules (`src/parser/*`), lexing, mapping, string/tree computation.
  Do not wrap pure code in Effect — synchronous parsing, validation, and
  option building stay synchronous.

## Module shape

- Keep the existing `export namespace Foo {}` convention (documented in
  `docs/ARCHITECTURE.md`). Do not switch module styles as part of Effect work.
- Service keys live in `src/runtime/services.ts`; layers and the runtime in
  `src/runtime/container.ts`.

## Service definition (v4)

```ts
export class FooService extends Context.Service<FooService, FooApi>()('FooService') {}
```

- `Context.Tag` does not exist in v4; `Context.Service<Self, Shape>()('Key')`
  is the replacement.
- Service keys are Effects: `yield* FooService` inside `Effect.gen`, or
  `runtime.runSync(FooService)` at the extraction edge.
- Bind services to named variables before calling methods. No nested
  `yield* (yield* Foo).bar()`.

## Layers

- `Layer.succeed` only for values that are genuinely construction-free.
- Anything with real initialization or teardown should become `Layer.effect`
  with `Effect.acquireRelease` / `Effect.addFinalizer` so
  `Container.dispose()` actually releases resources (target state — see
  `docs/effect/migration.md`, track LAYER).
- Keep composition explicit in `container.ts`. No hidden provisioning.

## Runtime boundaries

- One `ManagedRuntime` per process, built in `Container.build()`.
- LSP handlers are Promise-based today. Enter Effect with **one contiguous
  block per boundary crossing** — a single `runPromise(Effect.gen(...))`, not
  many small `runPromise` calls sprinkled through a handler.
- When a subsystem becomes Effect-native, delete its Promise facade rather
  than stacking wrappers. Callers move to the runtime edge.

## Effects

- `Effect.gen(function* () { ... })` for multi-step workflows.
- `Effect.fn('Domain.method')` for reusable/traced service methods;
  `Effect.fnUntraced` for internal helpers. Both accept pipeable operators as
  extra arguments — skip redundant outer `.pipe()`.
- `Effect.callback` (v4 rename of `Effect.async`) for callback APIs; honor the
  provided `AbortSignal` for interruption (see `php-runner.ts:executePhp`).
- `Effect.void` instead of `Effect.succeed(undefined)`.
- Fibers: `Effect.forkIn(scope)` / `Effect.forkScoped`. `Effect.fork` and
  `Effect.forkDaemon` do not exist in v4.
- Prefer `Effect.timeout` over hand-rolled `setTimeout` racing.

## Concurrency primitives (replace hand-rolled versions)

| Hand-rolled (current)                               | Effect primitive                       |
| --------------------------------------------------- | -------------------------------------- |
| `src/utils/lock.ts` promise RW lock                 | `Effect.Semaphore`                     |
| `MutableRef<Promise<boolean> \| null>` init mutex   | `Effect.cached` / `Deferred`           |
| Readiness callback arrays (php-bridge)              | `Deferred` / `Latch`                   |
| Manual lifecycle state machines (php-bridge)        | `Scope` + `Effect.acquireRelease`      |
| `Promise.allSettled` fan-out (`Laravel.refreshAll`) | `Effect.all` with `{ mode: 'either' }` |
| `src/utils/defer.ts` dispose helpers                | `Scope` / `Effect.addFinalizer`        |

Rule of thumb: if you are storing a `Promise | null` or `Fiber | undefined`
in a ref to dedupe concurrent work, use `Effect.cached` instead.

## Errors

- Expected failures are typed values in the error channel; defects are bugs.
- Current convention: zod-based `NamedError` (`src/utils/error.ts`). These are
  plain classes and interop fine with Effect's error channel (see
  `PhpRunner.ExecuteError`).
- For **new** Effect-native error surfaces, prefer `Schema.TaggedErrorClass`
  (v4; not `Data.TaggedError`) so `Effect.catchTag` works. Full unification is
  track ERR in the migration doc.
- Prefer `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))`
  once errors are `Schema.TaggedErrorClass`-based.
- Never use `catchCause`-style blanket handling in tool/handler code —
  interruption and defects must survive.

## ESM / build constraints

- `effect` v4 is ESM-only. This package compiles to CJS and loads it via
  Node's `require(esm)` — requires Node >= 20.19 (`engines` enforces this)
  and `module`/`moduleResolution: NodeNext` in `tsconfig.json`.
- Do not import from deep paths other than the package's declared exports
  (`effect`, `effect/unstable/*`, `effect/testing/*`).

## Testing

- Integration tests exercise the real runtime lifecycle
  (`tests/utils/connection.ts` → `Container.build()` / `dispose()`); keep that
  boundary intact.
- Unit tests stub the container via `Container.init()`
  (`tests/utils/laravel-mock.ts`).
- Never use `Effect.sleep(N)` (or real `setTimeout`) as synchronization in
  tests — wait on readiness signals (`Deferred.await`, polling with timeout).
- As subsystems become Effect-native, prefer explicit test layers over ad hoc
  runtimes, and scoped fixtures/finalizers for cleanup.
