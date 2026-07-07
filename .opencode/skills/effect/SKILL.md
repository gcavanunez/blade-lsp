---
name: effect
description: Work with Effect v4 / effect-smol TypeScript code in this repo
---

# Effect

This codebase uses Effect v4 (the effect-smol rewrite, `4.0.0-beta.x`) for
dependency injection, typed errors, and lifecycle/concurrency management.
Effect is used as a shell around I/O and lifecycle; the pure provider/parser
core stays plain TypeScript.

## Source Of Truth

Use the current Effect v4 / effect-smol source, not memory or older Effect v2/v3 examples.

1. If `.agents/resources/effect-smol` is missing, clone `https://github.com/Effect-TS/effect-smol` there. Do this in the project, not in the skill folder.
2. Search `.agents/resources/effect-smol` for exact APIs, examples, tests, and naming patterns before answering or implementing Effect-specific code. Alternatively, inspect `node_modules/effect/dist/*.d.ts` for the installed beta's exact signatures.
3. Also inspect existing repo code (`src/runtime/`, `src/laravel/php-runner.ts`) for local house style before introducing new patterns.
4. Prefer answers and implementations backed by specific source files or nearby repo examples.

## v4 API differences vs v3 (gotchas we already hit)

- `Context.Tag('X')<X, Shape>()` does not exist. Use `Context.Service<X, Shape>()('X')`.
- `Effect.async` is renamed `Effect.callback` (same resume + AbortSignal shape).
- `Effect.fork` / `Effect.forkDaemon` do not exist. Use `Effect.forkIn(scope)` or `Effect.forkScoped`.
- Typed errors: prefer `Schema.TaggedErrorClass` (not `Data.TaggedError`) when modeling new error surfaces. The repo's zod-based `NamedError` interops with the error channel and remains the current convention.
- The `effect` package is ESM-only. This project compiles CJS and relies on Node `require(esm)` (Node >= 20.19) with `moduleResolution: NodeNext`.

## Guidelines

- Use `Effect.gen(function* () { ... })` for multi-step workflows.
- Use `Effect.fn("Domain.method")` for named/traced reusable effects; `Effect.fnUntraced` for internal helpers.
- Use `Effect.callback` for callback-based APIs (child processes, event emitters).
- Use `Effect.void` instead of `Effect.succeed(undefined)`.
- In Effect generators, bind services to named variables before calling methods. No nested `yield* (yield* Foo).bar()`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building stay synchronous — this includes everything under `src/providers/` and `src/parser/` that is pure over `(source, tree, position)`.
- Keep layer composition explicit (`src/runtime/container.ts`). Avoid broad hidden provisioning.
- Prefer Effect concurrency primitives over hand-rolled ones: `Effect.Semaphore` over promise locks, `Effect.cached` over stored `Promise | null` mutexes, `Deferred`/`Latch` over readiness callbacks, `Scope`/`Effect.acquireRelease` over manual lifecycle state machines.
- Do not introduce `any`, non-null assertions, unchecked casts, or older Effect APIs just to satisfy types.
- Do not answer from memory. Verify against `.agents/resources/effect-smol`, the installed `.d.ts` files, or nearby repo code first.

## Runtime boundaries

- The Effect runtime lives in `src/runtime/container.ts` (`ManagedRuntime`). LSP handlers are Promise-based and enter Effect at explicit edges (`Effect.runPromise` today; a shared `Container` runtime `runPromise` as migration deepens).
- One contiguous Effect block per boundary crossing — do not scatter many tiny `runPromise` calls inside a single handler.
- See `docs/effect/guide.md` for house style and `docs/effect/migration.md` for the roadmap.
