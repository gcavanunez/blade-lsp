/**
 * Creates a disposable object that runs cleanup code at scope exit.
 * Works with `using` (sync) and `await using` (async) declarations.
 *
 * @example
 * ```typescript
 * function process() {
 *   using cleanup = defer(() => console.log("done"));
 *   // ... work ...
 *   // cleanup runs automatically at scope exit
 * }
 *
 * async function asyncProcess() {
 *   await using cleanup = defer(async () => await db.close());
 *   // ... work ...
 * }
 * ```
 */
export function defer<T extends () => void | Promise<void>>(
    fn: T,
): T extends () => Promise<void> ? { [Symbol.asyncDispose]: () => Promise<void> } : { [Symbol.dispose]: () => void } {
    return {
        [Symbol.dispose]() {
            fn();
        },
        [Symbol.asyncDispose]() {
            return Promise.resolve(fn());
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}
