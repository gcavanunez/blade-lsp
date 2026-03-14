import { afterEach, describe, expect, it, vi } from 'vitest';
import { Watcher } from '../../src/watcher';

describe('Watcher', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces and merges targets before a refresh starts', async () => {
        vi.useFakeTimers();

        const calls: string[][] = [];
        const refresh = Watcher.createDebouncedRefresh(async (targets) => {
            calls.push([...targets].sort());
        }, 100);

        refresh(new Set(['views']));
        refresh(new Set(['components']));

        await vi.advanceTimersByTimeAsync(100);

        expect(calls).toEqual([['components', 'views']]);
    });

    it('serializes async refreshes and queues a follow-up batch', async () => {
        vi.useFakeTimers();

        const calls: string[][] = [];
        let releaseCurrentBatch: (() => void) | null = null;

        const refresh = Watcher.createDebouncedRefresh(async (targets) => {
            calls.push([...targets].sort());
            await new Promise<void>((resolve) => {
                releaseCurrentBatch = resolve;
            });
        }, 100);

        refresh(new Set(['views']));
        await vi.advanceTimersByTimeAsync(100);
        expect(calls).toEqual([['views']]);

        refresh(new Set(['components']));
        refresh(new Set(['directives']));
        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toEqual([['views']]);

        expect(releaseCurrentBatch).not.toBeNull();
        (releaseCurrentBatch as unknown as () => void)();
        await vi.runAllTicks();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(99);
        expect(calls).toEqual([['views']]);

        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toEqual([['views'], ['components', 'directives']]);
    });
});
