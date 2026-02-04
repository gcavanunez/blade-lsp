/**
 * Creates a lazily-evaluated value that is computed on first access.
 * Subsequent calls return the cached value.
 *
 * @example
 * ```typescript
 * const getConnection = lazy(() => createConnection());
 *
 * getConnection(); // creates connection
 * getConnection(); // returns same connection
 * ```
 */
export function lazy<T>(fn: () => T) {
  let value: T | undefined;
  let loaded = false;

  return (): T => {
    if (loaded) return value as T;
    loaded = true;
    value = fn();
    return value;
  };
}
