/**
 * In-memory read/write lock keyed by string.
 *
 * Writers are preferred over readers once queued, which prevents writer starvation.
 * Callers receive `Disposable` guards intended for `using` blocks.
 */
export namespace Lock {
    const locks = new Map<
        string,
        {
            readers: number;
            writer: boolean;
            waitingReaders: (() => void)[];
            waitingWriters: (() => void)[];
        }
    >();

    function get(key: string) {
        if (!locks.has(key)) {
            locks.set(key, {
                readers: 0,
                writer: false,
                waitingReaders: [],
                waitingWriters: [],
            });
        }
        return locks.get(key)!;
    }

    function process(key: string) {
        const lock = locks.get(key);
        if (!lock || lock.writer || lock.readers > 0) return;

        // Serve a queued writer first, then release queued readers when no writer is waiting.
        if (lock.waitingWriters.length > 0) {
            const nextWriter = lock.waitingWriters.shift()!;
            nextWriter();
            return;
        }

        while (lock.waitingReaders.length > 0) {
            const nextReader = lock.waitingReaders.shift()!;
            nextReader();
        }

        if (
            lock.readers === 0 &&
            !lock.writer &&
            lock.waitingReaders.length === 0 &&
            lock.waitingWriters.length === 0
        ) {
            locks.delete(key);
        }
    }

    export async function read(key: string): Promise<Disposable> {
        const lock = get(key);

        return new Promise((resolve) => {
            // If a writer is waiting, queue new readers so writers are not starved.
            if (!lock.writer && lock.waitingWriters.length === 0) {
                lock.readers++;
                resolve({
                    [Symbol.dispose]: () => {
                        lock.readers--;
                        process(key);
                    },
                });
            } else {
                lock.waitingReaders.push(() => {
                    lock.readers++;
                    resolve({
                        [Symbol.dispose]: () => {
                            lock.readers--;
                            process(key);
                        },
                    });
                });
            }
        });
    }

    export async function write(key: string): Promise<Disposable> {
        const lock = get(key);

        return new Promise((resolve) => {
            if (!lock.writer && lock.readers === 0) {
                lock.writer = true;
                resolve({
                    [Symbol.dispose]: () => {
                        lock.writer = false;
                        process(key);
                    },
                });
            } else {
                lock.waitingWriters.push(() => {
                    lock.writer = true;
                    resolve({
                        [Symbol.dispose]: () => {
                            lock.writer = false;
                            process(key);
                        },
                    });
                });
            }
        });
    }
}
