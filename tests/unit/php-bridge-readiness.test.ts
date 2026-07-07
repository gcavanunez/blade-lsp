import { describe, expect, it } from 'vitest';
import { Readiness } from '../../src/providers/php-bridge/readiness';

/** Apply a sequence of events, returning the final snapshot and every transition. */
function run(events: Readiness.Event[], from: Readiness.Snapshot = Readiness.initial()) {
    const transitions: Readiness.Transition[] = [];
    let snapshot = from;
    for (const event of events) {
        const transition = Readiness.reduce(snapshot, event);
        transitions.push(transition);
        snapshot = transition.next;
    }
    return { snapshot, transitions };
}

describe('Readiness reducer', () => {
    it('starts awaiting the index signal', () => {
        const snapshot = Readiness.initial();
        expect(snapshot.readiness.kind).toBe('awaiting-index-signal');
        expect(snapshot.indexingLifecycle).toBe('unknown');
        expect(Readiness.isSettled(snapshot.readiness)).toBe(false);
    });

    it('indexing-started moves to indexing-running', () => {
        const { snapshot } = run([{ type: 'indexing-started' }]);
        expect(snapshot.readiness.kind).toBe('indexing-running');
        expect(snapshot.indexingLifecycle).toBe('started');
    });

    it('indexing-ended with no live progress settles ready', () => {
        const { snapshot, transitions } = run([{ type: 'indexing-started' }, { type: 'indexing-ended' }]);
        expect(snapshot.readiness.kind).toBe('ready');
        expect(transitions[1].settled).toBe(true);
    });

    it('indexing-ended straight from awaiting settles ready', () => {
        const { snapshot, transitions } = run([{ type: 'indexing-ended' }]);
        expect(snapshot.readiness.kind).toBe('ready');
        expect(transitions[0].settled).toBe(true);
    });

    it('progress-begin before any indexing signal starts indexing-running', () => {
        const { snapshot } = run([{ type: 'progress-begin', token: 'a' }]);
        expect(snapshot.readiness.kind).toBe('indexing-running');
        // lifecycle is untouched by progress events
        expect(snapshot.indexingLifecycle).toBe('unknown');
    });

    it('waits for outstanding progress tokens before settling', () => {
        const { snapshot, transitions } = run([
            { type: 'indexing-started' },
            { type: 'progress-begin', token: 'a' },
            { type: 'progress-begin', token: 'b' },
            { type: 'indexing-ended' },
            { type: 'progress-end', token: 'a' },
            { type: 'progress-end', token: 'b' },
        ]);

        expect(transitions[3].next.readiness.kind).toBe('indexing-finishing');
        expect(transitions[4].settled).toBe(false);
        expect(transitions[5].settled).toBe(true);
        expect(snapshot.readiness.kind).toBe('ready');
    });

    it('does not settle when the last token ends mid-index', () => {
        const { snapshot, transitions } = run([
            { type: 'indexing-started' },
            { type: 'progress-begin', token: 'a' },
            { type: 'progress-end', token: 'a' },
        ]);

        // lifecycle is still 'started' — the indexer has not signaled the end.
        expect(transitions[2].settled).toBe(false);
        expect(snapshot.readiness.kind).toBe('indexing-running');
    });

    it('progress-begin during indexing-finishing resumes indexing-running', () => {
        const { snapshot } = run([
            { type: 'indexing-started' },
            { type: 'progress-begin', token: 'a' },
            { type: 'indexing-ended' },
            { type: 'progress-begin', token: 'b' },
        ]);

        expect(snapshot.readiness.kind).toBe('indexing-running');
        expect(snapshot.readiness.kind === 'indexing-running' && snapshot.readiness.progressTokens.size).toBe(2);
    });

    it('a second indexing-started restarts from indexing-finishing', () => {
        const { snapshot } = run([
            { type: 'indexing-started' },
            { type: 'progress-begin', token: 'a' },
            { type: 'indexing-ended' },
            { type: 'indexing-started' },
        ]);

        expect(snapshot.readiness.kind).toBe('indexing-running');
        expect(snapshot.indexingLifecycle).toBe('started');
    });

    it('assume-ready settles from any unsettled state', () => {
        const { snapshot, transitions } = run([{ type: 'indexing-started' }, { type: 'assume-ready' }]);
        expect(snapshot.readiness.kind).toBe('ready');
        expect(transitions[1].settled).toBe(true);
    });

    it('assume-ready is a no-op once settled', () => {
        const { transitions } = run([{ type: 'indexing-ended' }, { type: 'assume-ready' }]);
        expect(transitions[1].settled).toBe(false);
        expect(transitions[1].next.readiness.kind).toBe('ready');
    });

    it('degrade settles from any state, even ready', () => {
        const { snapshot, transitions } = run([
            { type: 'indexing-ended' },
            { type: 'degrade', reason: 'indexer-crash' },
        ]);

        expect(transitions[1].settled).toBe(true);
        expect(snapshot.readiness).toEqual({ kind: 'degraded', reason: 'indexer-crash' });
    });

    it('progress and indexing events cannot unsettle a ready state', () => {
        const { snapshot, transitions } = run([
            { type: 'indexing-ended' },
            { type: 'indexing-started' },
            { type: 'progress-begin', token: 'x' },
            { type: 'progress-end', token: 'x' },
            { type: 'indexing-ended' },
        ]);

        expect(snapshot.readiness.kind).toBe('ready');
        expect(transitions.slice(1).every((t) => !t.settled)).toBe(true);
    });

    it('never mutates the input snapshot', () => {
        const initial = Readiness.initial();
        const afterBegin = Readiness.reduce(initial, { type: 'progress-begin', token: 'a' }).next;
        const frozenTokens =
            afterBegin.readiness.kind === 'indexing-running' ? afterBegin.readiness.progressTokens : null;

        Readiness.reduce(afterBegin, { type: 'progress-begin', token: 'b' });
        Readiness.reduce(afterBegin, { type: 'progress-end', token: 'a' });

        expect(initial.readiness.kind).toBe('awaiting-index-signal');
        expect(frozenTokens?.size).toBe(1);
    });
});
