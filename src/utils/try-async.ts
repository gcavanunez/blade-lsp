type TryResult<T, E = Error> = { result: T; error: null } | { result: null; error: E };

export async function tryAsync<T, E = Error>(fn: () => Promise<T>): Promise<TryResult<T, E>> {
    try {
        const result = await fn();
        return { result, error: null };
    } catch (error) {
        return { result: null, error: error as E };
    }
}
