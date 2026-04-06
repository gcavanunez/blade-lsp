/**
 * Baseline benchmarks for line-splitting operations.
 *
 * Measures the cost of `source.split('\n')` at various template sizes.
 * After PR 1 (LineIndex), add comparison benchmarks here to quantify the improvement.
 */

import { bench, describe } from 'vitest';
import { SMALL_TEMPLATE, MEDIUM_TEMPLATE, LARGE_TEMPLATE } from '../fixtures';

describe("split('\\n') — full array allocation", () => {
    bench('100 lines', () => {
        SMALL_TEMPLATE.split('\n');
    });

    bench('500 lines', () => {
        MEDIUM_TEMPLATE.split('\n');
    });

    bench('2000 lines', () => {
        LARGE_TEMPLATE.split('\n');
    });
});

describe("split('\\n') + line access — simulates provider pattern", () => {
    const line50 = 50;
    const line250 = 250;
    const line1000 = 1000;

    bench('100 lines — access line 50', () => {
        const lines = SMALL_TEMPLATE.split('\n');
        void lines[line50];
    });

    bench('500 lines — access line 250', () => {
        const lines = MEDIUM_TEMPLATE.split('\n');
        void lines[line250];
    });

    bench('2000 lines — access line 1000', () => {
        const lines = LARGE_TEMPLATE.split('\n');
        void lines[line1000];
    });
});

describe("split('\\n') repeated — simulates per-request hot path", () => {
    bench('500 lines x5 splits (typical handler chain)', () => {
        for (let i = 0; i < 5; i++) {
            MEDIUM_TEMPLATE.split('\n');
        }
    });

    bench('2000 lines x5 splits (typical handler chain)', () => {
        for (let i = 0; i < 5; i++) {
            LARGE_TEMPLATE.split('\n');
        }
    });
});
