/**
 * Benchmarks comparing split('\n') vs LineIndex for line operations.
 *
 * Includes both the old baseline (split) and the new approach (LineIndex)
 * so the improvement is visible in a single `vitest bench` run.
 */

import { bench, describe } from 'vitest';
import { LineIndex } from '../../src/utils/line-index';
import { SMALL_TEMPLATE, MEDIUM_TEMPLATE, LARGE_TEMPLATE } from '../fixtures';

// ─── Construction cost ──────────────────────────────────────────────────────

describe('construction cost — split vs LineIndex', () => {
    bench('split(\\n) — 100 lines', () => {
        SMALL_TEMPLATE.split('\n');
    });

    bench('LineIndex  — 100 lines', () => {
        new LineIndex(SMALL_TEMPLATE);
    });

    bench('split(\\n) — 500 lines', () => {
        MEDIUM_TEMPLATE.split('\n');
    });

    bench('LineIndex  — 500 lines', () => {
        new LineIndex(MEDIUM_TEMPLATE);
    });

    bench('split(\\n) — 2000 lines', () => {
        LARGE_TEMPLATE.split('\n');
    });

    bench('LineIndex  — 2000 lines', () => {
        new LineIndex(LARGE_TEMPLATE);
    });
});

// ─── Single line access ─────────────────────────────────────────────────────

describe('single line access — split[n] vs LineIndex.getLineText(n)', () => {
    const line50 = 50;
    const line250 = 250;
    const line1000 = 1000;

    // Pre-built LineIndexes (simulates caching per document version)
    const smallIdx = new LineIndex(SMALL_TEMPLATE);
    const mediumIdx = new LineIndex(MEDIUM_TEMPLATE);
    const largeIdx = new LineIndex(LARGE_TEMPLATE);

    bench('split + index — 100 lines', () => {
        void SMALL_TEMPLATE.split('\n')[line50];
    });

    bench('LineIndex.getLineText — 100 lines', () => {
        void smallIdx.getLineText(line50);
    });

    bench('split + index — 500 lines', () => {
        void MEDIUM_TEMPLATE.split('\n')[line250];
    });

    bench('LineIndex.getLineText — 500 lines', () => {
        void mediumIdx.getLineText(line250);
    });

    bench('split + index — 2000 lines', () => {
        void LARGE_TEMPLATE.split('\n')[line1000];
    });

    bench('LineIndex.getLineText — 2000 lines', () => {
        void largeIdx.getLineText(line1000);
    });
});

// ─── Repeated access (handler chain simulation) ─────────────────────────────

describe('5x line access — split each time vs single LineIndex', () => {
    const mediumIdx = new LineIndex(MEDIUM_TEMPLATE);
    const largeIdx = new LineIndex(LARGE_TEMPLATE);

    bench('split x5 — 500 lines', () => {
        for (let i = 0; i < 5; i++) {
            void MEDIUM_TEMPLATE.split('\n')[i * 50];
        }
    });

    bench('LineIndex x5 — 500 lines', () => {
        for (let i = 0; i < 5; i++) {
            void mediumIdx.getLineText(i * 50);
        }
    });

    bench('split x5 — 2000 lines', () => {
        for (let i = 0; i < 5; i++) {
            void LARGE_TEMPLATE.split('\n')[i * 200];
        }
    });

    bench('LineIndex x5 — 2000 lines', () => {
        for (let i = 0; i < 5; i++) {
            void largeIdx.getLineText(i * 200);
        }
    });
});
