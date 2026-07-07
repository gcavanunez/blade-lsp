import { Cause, Effect, Exit } from 'effect';

/**
 * Run an Effect in a test.
 *
 * - Typed failures are rethrown as-is, so `expect(...).rejects` and
 *   `instanceof` assertions see the original error.
 * - Defects and interruptions are thrown as an `Error` carrying the pretty
 *   printed cause, so test output stays readable.
 */
export async function runTest<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect);

    if (Exit.isSuccess(exit)) {
        return exit.value;
    }

    for (const reason of exit.cause.reasons) {
        if (reason._tag === 'Fail') {
            throw reason.error;
        }
    }

    throw new Error(Cause.pretty(exit.cause));
}
