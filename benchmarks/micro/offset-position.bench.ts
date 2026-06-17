/**
 * Benchmarks comparing split-based vs LineIndex offset<->position conversion.
 *
 * This is the hottest path in the PHP bridge -- called per-position-mapping
 * during completion remapping. The baseline uses the old split-based approach;
 * the comparison uses pre-built LineIndex instances.
 */

import { bench, describe } from 'vitest';
import { LineIndex } from '../../src/utils/line-index';
import { MEDIUM_TEMPLATE, LARGE_TEMPLATE, randomOffset } from '../fixtures';

// Pre-compute stable positions for consistent benchmarking
const mediumOffsets = Array.from({ length: 100 }, () => randomOffset(MEDIUM_TEMPLATE));
const largeOffsets = Array.from({ length: 100 }, () => randomOffset(LARGE_TEMPLATE));

// Pre-built LineIndexes (what callers now do: build once, reuse)
const mediumIdx = new LineIndex(MEDIUM_TEMPLATE);
const largeIdx = new LineIndex(LARGE_TEMPLATE);

// Convert some offsets to positions for the reverse benchmark
const mediumPositions = mediumOffsets.map((o) => mediumIdx.offsetToPosition(o));
const largePositions = largeOffsets.map((o) => largeIdx.offsetToPosition(o));

// ─── Old split-based approach (baseline from before migration) ──────────────

function splitOffsetToPosition(source: string, offset: number) {
    const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
    const parts = before.split('\n');
    return { line: parts.length - 1, character: parts[parts.length - 1]?.length ?? 0 };
}

function splitPositionToOffset(source: string, position: { line: number; character: number }) {
    const lines = source.split('\n');
    let offset = 0;
    const targetLine = Math.max(0, Math.min(position.line, lines.length - 1));
    for (let line = 0; line < targetLine; line++) {
        offset += lines[line].length + 1;
    }
    return offset + Math.max(0, Math.min(position.character, lines[targetLine]?.length ?? 0));
}

// ─── offsetToPosition ───────────────────────────────────────────────────────

describe('offsetToPosition -- split vs LineIndex', () => {
    let idx = 0;

    bench('split-based -- 500 lines', () => {
        splitOffsetToPosition(MEDIUM_TEMPLATE, mediumOffsets[idx++ % 100]);
    });

    bench('LineIndex   -- 500 lines', () => {
        mediumIdx.offsetToPosition(mediumOffsets[idx++ % 100]);
    });

    bench('split-based -- 2000 lines', () => {
        splitOffsetToPosition(LARGE_TEMPLATE, largeOffsets[idx++ % 100]);
    });

    bench('LineIndex   -- 2000 lines', () => {
        largeIdx.offsetToPosition(largeOffsets[idx++ % 100]);
    });
});

// ─── positionToOffset ───────────────────────────────────────────────────────

describe('positionToOffset -- split vs LineIndex', () => {
    let idx = 0;

    bench('split-based -- 500 lines', () => {
        splitPositionToOffset(MEDIUM_TEMPLATE, mediumPositions[idx++ % 100]);
    });

    bench('LineIndex   -- 500 lines', () => {
        mediumIdx.positionToOffset(mediumPositions[idx++ % 100]);
    });

    bench('split-based -- 2000 lines', () => {
        splitPositionToOffset(LARGE_TEMPLATE, largePositions[idx++ % 100]);
    });

    bench('LineIndex   -- 2000 lines', () => {
        largeIdx.positionToOffset(largePositions[idx++ % 100]);
    });
});

// ─── Round-trip (completion remapping simulation) ───────────────────────────

describe('100 round-trips -- split vs LineIndex (completion batch)', () => {
    bench('split-based -- 500 lines', () => {
        for (let i = 0; i < 100; i++) {
            const pos = splitOffsetToPosition(MEDIUM_TEMPLATE, mediumOffsets[i]);
            splitPositionToOffset(MEDIUM_TEMPLATE, pos);
        }
    });

    bench('LineIndex   -- 500 lines', () => {
        for (let i = 0; i < 100; i++) {
            const pos = mediumIdx.offsetToPosition(mediumOffsets[i]);
            mediumIdx.positionToOffset(pos);
        }
    });

    bench('split-based -- 2000 lines', () => {
        for (let i = 0; i < 100; i++) {
            const pos = splitOffsetToPosition(LARGE_TEMPLATE, largeOffsets[i]);
            splitPositionToOffset(LARGE_TEMPLATE, pos);
        }
    });

    bench('LineIndex   -- 2000 lines', () => {
        for (let i = 0; i < 100; i++) {
            const pos = largeIdx.offsetToPosition(largeOffsets[i]);
            largeIdx.positionToOffset(pos);
        }
    });
});
