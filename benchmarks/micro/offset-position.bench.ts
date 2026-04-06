/**
 * Baseline benchmarks for offset <-> position conversion.
 *
 * Measures the cost of the current split-based `offsetToPosition` and
 * `positionToOffset` in mapping.ts. These are the hottest functions in
 * the PHP bridge — called per-position-mapping during completion remapping.
 *
 * After PR 1 (LineIndex), add comparison benchmarks here.
 */

import { bench, describe } from 'vitest';
import { PhpBridgeMapping } from '../../src/providers/php-bridge/mapping';
import { MEDIUM_TEMPLATE, LARGE_TEMPLATE, randomOffset } from '../fixtures';

// Pre-compute stable positions for consistent benchmarking.
const mediumOffsets = Array.from({ length: 100 }, () => randomOffset(MEDIUM_TEMPLATE));
const largeOffsets = Array.from({ length: 100 }, () => randomOffset(LARGE_TEMPLATE));

// Convert some offsets to positions for the reverse benchmark
const mediumPositions = mediumOffsets.map((o) => PhpBridgeMapping.offsetToPosition(MEDIUM_TEMPLATE, o));
const largePositions = largeOffsets.map((o) => PhpBridgeMapping.offsetToPosition(LARGE_TEMPLATE, o));

describe('offsetToPosition (split-based, current)', () => {
    let idx = 0;

    bench('500 lines — single call', () => {
        PhpBridgeMapping.offsetToPosition(MEDIUM_TEMPLATE, mediumOffsets[idx++ % 100]);
    });

    bench('2000 lines — single call', () => {
        PhpBridgeMapping.offsetToPosition(LARGE_TEMPLATE, largeOffsets[idx++ % 100]);
    });
});

describe('positionToOffset (split-based, current)', () => {
    let idx = 0;

    bench('500 lines — single call', () => {
        PhpBridgeMapping.positionToOffset(MEDIUM_TEMPLATE, mediumPositions[idx++ % 100]);
    });

    bench('2000 lines — single call', () => {
        PhpBridgeMapping.positionToOffset(LARGE_TEMPLATE, largePositions[idx++ % 100]);
    });
});

describe('offset round-trip — simulates completion item remapping', () => {
    bench('500 lines — 100 round-trips (typical completion batch)', () => {
        for (let i = 0; i < 100; i++) {
            const pos = PhpBridgeMapping.offsetToPosition(MEDIUM_TEMPLATE, mediumOffsets[i]);
            PhpBridgeMapping.positionToOffset(MEDIUM_TEMPLATE, pos);
        }
    });

    bench('2000 lines — 100 round-trips (typical completion batch)', () => {
        for (let i = 0; i < 100; i++) {
            const pos = PhpBridgeMapping.offsetToPosition(LARGE_TEMPLATE, largeOffsets[i]);
            PhpBridgeMapping.positionToOffset(LARGE_TEMPLATE, pos);
        }
    });
});
