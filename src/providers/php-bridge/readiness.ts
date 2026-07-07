/**
 * Pure readiness state machine for embedded PHP LSP backends.
 *
 * Tracks whether a backend has finished its initial workspace indexing so
 * bridge features can wait for meaningful results. Backends signal progress
 * through `indexingStarted`/`indexingEnded` notifications (intelephense) and
 * `$/progress` begin/end pairs; some never signal at all (handled by the
 * caller's grace-period heuristic dispatching `assume-ready`).
 *
 * This module is a pure reducer: `reduce(snapshot, event)` returns the next
 * snapshot plus whether the state became settled (ready or degraded), which
 * tells the effectful caller to flush ready callbacks. All side effects
 * (callback flushing, logging, timers) stay in `backend.ts`.
 */

export namespace Readiness {
    export type ProgressToken = number | string;

    export type State =
        | { kind: 'awaiting-index-signal' }
        | { kind: 'indexing-running'; progressTokens: Set<ProgressToken> }
        | { kind: 'indexing-finishing'; progressTokens: Set<ProgressToken> }
        | { kind: 'ready' }
        | { kind: 'degraded'; reason: string };

    export type IndexingLifecycle = 'unknown' | 'started' | 'ended';

    export interface Snapshot {
        readonly readiness: State;
        readonly indexingLifecycle: IndexingLifecycle;
    }

    export type Event =
        | { type: 'indexing-started' }
        | { type: 'indexing-ended' }
        | { type: 'progress-begin'; token: ProgressToken }
        | { type: 'progress-end'; token: ProgressToken }
        | { type: 'degrade'; reason: string }
        | { type: 'assume-ready' };

    export interface Transition {
        readonly next: Snapshot;
        /** True when this event settled the state — the caller should flush ready callbacks. */
        readonly settled: boolean;
    }

    export function initial(): Snapshot {
        return { readiness: { kind: 'awaiting-index-signal' }, indexingLifecycle: 'unknown' };
    }

    /** A settled state fires callbacks immediately and never transitions again (except degrade). */
    export function isSettled(state: State): boolean {
        return state.kind === 'ready' || state.kind === 'degraded';
    }

    export function reduce(current: Snapshot, event: Event): Transition {
        switch (event.type) {
            case 'indexing-started':
                return indexingStarted(current);
            case 'indexing-ended':
                return indexingEnded(current);
            case 'progress-begin':
                return progressBegin(current, event.token);
            case 'progress-end':
                return progressEnd(current, event.token);
            case 'degrade':
                // Degrade always settles, even from `ready` (an indexer crash
                // after readiness downgrades the state and re-flushes, which
                // is a no-op when no callbacks are pending).
                return {
                    next: { ...current, readiness: { kind: 'degraded', reason: event.reason } },
                    settled: true,
                };
            case 'assume-ready':
                return ready(current);
        }
    }

    /** Transition to `ready` unless already settled. */
    function ready(current: Snapshot): Transition {
        if (isSettled(current.readiness)) {
            return { next: current, settled: false };
        }
        return { next: { ...current, readiness: { kind: 'ready' } }, settled: true };
    }

    function indexingStarted(current: Snapshot): Transition {
        const base: Snapshot = { ...current, indexingLifecycle: 'started' };

        switch (current.readiness.kind) {
            case 'awaiting-index-signal':
                return {
                    next: { ...base, readiness: { kind: 'indexing-running', progressTokens: new Set() } },
                    settled: false,
                };
            case 'indexing-finishing':
                return {
                    next: {
                        ...base,
                        readiness: {
                            kind: 'indexing-running',
                            progressTokens: new Set(current.readiness.progressTokens),
                        },
                    },
                    settled: false,
                };
            case 'indexing-running':
            case 'ready':
            case 'degraded':
                return { next: base, settled: false };
        }
    }

    function indexingEnded(current: Snapshot): Transition {
        const base: Snapshot = { ...current, indexingLifecycle: 'ended' };

        switch (current.readiness.kind) {
            case 'awaiting-index-signal':
                return ready(base);
            case 'indexing-running':
                if (current.readiness.progressTokens.size === 0) {
                    return ready(base);
                }
                return {
                    next: {
                        ...base,
                        readiness: {
                            kind: 'indexing-finishing',
                            progressTokens: new Set(current.readiness.progressTokens),
                        },
                    },
                    settled: false,
                };
            case 'indexing-finishing':
                if (current.readiness.progressTokens.size === 0) {
                    return ready(base);
                }
                return { next: base, settled: false };
            case 'ready':
            case 'degraded':
                return { next: base, settled: false };
        }
    }

    function progressBegin(current: Snapshot, token: ProgressToken): Transition {
        switch (current.readiness.kind) {
            case 'awaiting-index-signal':
                return {
                    next: { ...current, readiness: { kind: 'indexing-running', progressTokens: new Set([token]) } },
                    settled: false,
                };
            case 'indexing-running': {
                const progressTokens = new Set(current.readiness.progressTokens);
                progressTokens.add(token);
                return {
                    next: { ...current, readiness: { kind: 'indexing-running', progressTokens } },
                    settled: false,
                };
            }
            case 'indexing-finishing': {
                const progressTokens = new Set(current.readiness.progressTokens);
                progressTokens.add(token);
                return {
                    next: { ...current, readiness: { kind: 'indexing-running', progressTokens } },
                    settled: false,
                };
            }
            case 'ready':
            case 'degraded':
                return { next: current, settled: false };
        }
    }

    function progressEnd(current: Snapshot, token: ProgressToken): Transition {
        switch (current.readiness.kind) {
            case 'indexing-running':
            case 'indexing-finishing': {
                const progressTokens = new Set(current.readiness.progressTokens);
                progressTokens.delete(token);

                // All progress done and the backend is not mid-index: ready.
                if (progressTokens.size === 0 && current.indexingLifecycle !== 'started') {
                    return ready(current);
                }

                // Defensive: `indexing-finishing` with no live tokens is ready
                // regardless of the lifecycle flag (mirrors the original
                // machine's second check).
                if (current.readiness.kind === 'indexing-finishing' && progressTokens.size === 0) {
                    return ready(current);
                }

                return {
                    next: { ...current, readiness: { kind: current.readiness.kind, progressTokens } },
                    settled: false,
                };
            }
            case 'awaiting-index-signal':
            case 'ready':
            case 'degraded':
                return { next: current, settled: false };
        }
    }
}
