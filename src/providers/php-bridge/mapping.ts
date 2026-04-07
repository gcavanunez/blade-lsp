import { Position, Range } from 'vscode-languageserver/node';
import { LineIndex } from '../../utils/line-index';
import { PhpBridgeShadowDocument } from './shadow-document';

export namespace PhpBridgeMapping {
    export type MappingKind = 'mapped' | 'synthetic' | 'unmappable';

    export type PositionMappingResult =
        | { kind: 'mapped'; position: Position; regionId: string }
        | { kind: 'synthetic' | 'unmappable' };

    export type RangeMappingResult =
        | { kind: 'mapped'; range: Range; regionId: string }
        | { kind: 'synthetic' | 'unmappable' };

    export function findRegionByBladeOffset(
        regions: PhpBridgeShadowDocument.ShadowRegion[],
        offset: number,
    ): PhpBridgeShadowDocument.ShadowRegion | undefined {
        let lo = 0;
        let hi = regions.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const r = regions[mid];
            if (offset < r.bladeContentOffsetStart) {
                hi = mid - 1;
            } else if (offset > r.bladeContentOffsetEnd) {
                lo = mid + 1;
            } else {
                return r;
            }
        }
        return undefined;
    }

    export function findRegionByShadowOffset(
        regions: PhpBridgeShadowDocument.ShadowRegion[],
        offset: number,
    ): PhpBridgeShadowDocument.ShadowRegion | undefined {
        let lo = 0;
        let hi = regions.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const r = regions[mid];
            if (offset < r.shadowContentOffsetStart) {
                hi = mid - 1;
            } else if (offset > r.shadowContentOffsetEnd) {
                lo = mid + 1;
            } else {
                return r;
            }
        }
        return undefined;
    }

    export function offsetToPosition(source: string, offset: number): Position {
        const safeOffset = Math.max(0, Math.min(offset, source.length));
        const idx = new LineIndex(source);
        return idx.offsetToPosition(safeOffset);
    }

    export function positionToOffset(source: string, position: Position): number {
        const idx = new LineIndex(source);
        return idx.positionToOffset(position);
    }

    export function bladePositionToShadowPosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
        bladeLineIndex?: LineIndex,
    ): PositionMappingResult {
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);
        const bladeOffset = bladeIdx.positionToOffset(position);
        const region = findRegionByBladeOffset(shadow.regions, bladeOffset);

        if (!region) {
            return { kind: 'unmappable' };
        }

        const shadowOffset = region.shadowContentOffsetStart + (bladeOffset - region.bladeContentOffsetStart);
        return {
            kind: 'mapped',
            regionId: region.id,
            position: shadow.lineIndex.offsetToPosition(shadowOffset),
        };
    }

    export function shadowPositionToBladePosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
        bladeLineIndex?: LineIndex,
    ): PositionMappingResult {
        const shadowOffset = shadow.lineIndex.positionToOffset(position);
        const region = findRegionByShadowOffset(shadow.regions, shadowOffset);

        if (region) {
            const bladeOffset = region.bladeContentOffsetStart + (shadowOffset - region.shadowContentOffsetStart);
            const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);
            return {
                kind: 'mapped',
                regionId: region.id,
                position: bladeIdx.offsetToPosition(bladeOffset),
            };
        }

        const maxShadowOffset = shadow.regions.reduce((max, item) => Math.max(max, item.shadowContentOffsetEnd), 0);
        return { kind: shadowOffset <= maxShadowOffset ? 'synthetic' : 'unmappable' };
    }

    export function shadowRangeToBladeRange(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        range: Range,
        bladeLineIndex?: LineIndex,
    ): RangeMappingResult {
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);

        const start = shadowPositionToBladePosition(bladeSource, shadow, range.start, bladeIdx);
        const end = shadowPositionToBladePosition(bladeSource, shadow, range.end, bladeIdx);

        if (start.kind !== 'mapped' || end.kind !== 'mapped') {
            return { kind: start.kind === 'synthetic' || end.kind === 'synthetic' ? 'synthetic' : 'unmappable' };
        }

        if (start.regionId !== end.regionId) {
            return { kind: 'unmappable' };
        }

        return {
            kind: 'mapped',
            regionId: start.regionId,
            range: Range.create(start.position, end.position),
        };
    }

    export function bladeRangeToShadowRange(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        range: Range,
        bladeLineIndex?: LineIndex,
    ): RangeMappingResult {
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);

        const start = bladePositionToShadowPosition(bladeSource, shadow, range.start, bladeIdx);
        const end = bladePositionToShadowPosition(bladeSource, shadow, range.end, bladeIdx);

        if (start.kind !== 'mapped' || end.kind !== 'mapped') {
            return { kind: 'unmappable' };
        }

        if (start.regionId !== end.regionId) {
            return { kind: 'unmappable' };
        }

        return {
            kind: 'mapped',
            regionId: start.regionId,
            range: Range.create(start.position, end.position),
        };
    }
}
