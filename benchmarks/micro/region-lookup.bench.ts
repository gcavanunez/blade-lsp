/**
 * Baseline benchmarks for PHP region lookup.
 *
 * Measures the cost of the current linear `.find()` scan used in
 * mapping.ts to locate which region contains a given offset.
 *
 * After PR 2 (offset-only mapping + binary search), add comparison benchmarks here.
 */

import { bench, describe } from 'vitest';
import {
    TEMPLATE_5_REGIONS,
    TEMPLATE_10_REGIONS,
    TEMPLATE_20_REGIONS,
    prepareExtraction,
    prepareShadow,
    randomPhpOffset,
} from '../fixtures';

// Pre-compute extractions and shadow documents
const ext5 = prepareExtraction(TEMPLATE_5_REGIONS);
const ext10 = prepareExtraction(TEMPLATE_10_REGIONS);
const ext20 = prepareExtraction(TEMPLATE_20_REGIONS);

const shadow5 = prepareShadow(TEMPLATE_5_REGIONS, ext5);
const shadow10 = prepareShadow(TEMPLATE_10_REGIONS, ext10);
const shadow20 = prepareShadow(TEMPLATE_20_REGIONS, ext20);

// Pre-compute random offsets that hit PHP regions
const offsets5 = Array.from({ length: 50 }, () => randomPhpOffset(TEMPLATE_5_REGIONS, ext5));
const offsets10 = Array.from({ length: 50 }, () => randomPhpOffset(TEMPLATE_10_REGIONS, ext10));
const offsets20 = Array.from({ length: 50 }, () => randomPhpOffset(TEMPLATE_20_REGIONS, ext20));

describe('region lookup — linear find (current, by blade offset)', () => {
    let idx = 0;

    bench('5 regions', () => {
        const { offset } = offsets5[idx++ % 50];
        shadow5.regions.find((r) => offset >= r.bladeContentOffsetStart && offset <= r.bladeContentOffsetEnd);
    });

    bench('10 regions', () => {
        const { offset } = offsets10[idx++ % 50];
        shadow10.regions.find((r) => offset >= r.bladeContentOffsetStart && offset <= r.bladeContentOffsetEnd);
    });

    bench('20 regions', () => {
        const { offset } = offsets20[idx++ % 50];
        shadow20.regions.find((r) => offset >= r.bladeContentOffsetStart && offset <= r.bladeContentOffsetEnd);
    });
});

describe('region lookup — linear find (current, by shadow offset)', () => {
    // Shadow offsets for the same regions
    const shadowOffsets5 = offsets5.map(({ offset, region }) => {
        const sr = shadow5.regions.find((r) => r.id === region.id)!;
        return sr.shadowContentOffsetStart + (offset - region.contentOffsetStart);
    });
    const shadowOffsets20 = offsets20.map(({ offset, region }) => {
        const sr = shadow20.regions.find((r) => r.id === region.id)!;
        return sr.shadowContentOffsetStart + (offset - region.contentOffsetStart);
    });

    let idx = 0;

    bench('5 regions', () => {
        const shadowOffset = shadowOffsets5[idx++ % 50];
        shadow5.regions.find(
            (r) => shadowOffset >= r.shadowContentOffsetStart && shadowOffset <= r.shadowContentOffsetEnd,
        );
    });

    bench('20 regions', () => {
        const shadowOffset = shadowOffsets20[idx++ % 50];
        shadow20.regions.find(
            (r) => shadowOffset >= r.shadowContentOffsetStart && shadowOffset <= r.shadowContentOffsetEnd,
        );
    });
});
