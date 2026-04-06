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

    /**
     * Convert a byte offset to a Position.
     *
     * When a `LineIndex` is available, prefer calling `lineIndex.offsetToPosition()`
     * directly. This overload exists for call sites that only have a raw string
     * (e.g., `regions.ts` during extraction).
     */
    export function offsetToPosition(source: string, offset: number): Position {
        const safeOffset = Math.max(0, Math.min(offset, source.length));
        // Fast path: build a temporary LineIndex. For hot paths, callers should
        // pre-build and reuse a LineIndex instead of calling this function.
        const idx = new LineIndex(source);
        return idx.offsetToPosition(safeOffset);
    }

    /**
     * Convert a Position to a byte offset.
     *
     * When a `LineIndex` is available, prefer calling `lineIndex.positionToOffset()`
     * directly. This overload exists for call sites that only have a raw string.
     */
    export function positionToOffset(source: string, position: Position): number {
        const idx = new LineIndex(source);
        return idx.positionToOffset(position);
    }

    export function bladePositionToShadowPosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
        bladeLineIndex?: LineIndex,
        shadowLineIndex?: LineIndex,
    ): PositionMappingResult {
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);
        const bladeOffset = bladeIdx.positionToOffset(position);
        const region = shadow.regions.find(
            (item) => bladeOffset >= item.bladeContentOffsetStart && bladeOffset <= item.bladeContentOffsetEnd,
        );

        if (!region) {
            return { kind: 'unmappable' };
        }

        const shadowOffset = region.shadowContentOffsetStart + (bladeOffset - region.bladeContentOffsetStart);
        const shadowIdx = shadowLineIndex ?? new LineIndex(shadow.content);
        return {
            kind: 'mapped',
            regionId: region.id,
            position: shadowIdx.offsetToPosition(shadowOffset),
        };
    }

    export function shadowPositionToBladePosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
        bladeLineIndex?: LineIndex,
        shadowLineIndex?: LineIndex,
    ): PositionMappingResult {
        const shadowIdx = shadowLineIndex ?? new LineIndex(shadow.content);
        const shadowOffset = shadowIdx.positionToOffset(position);
        const region = shadow.regions.find(
            (item) => shadowOffset >= item.shadowContentOffsetStart && shadowOffset <= item.shadowContentOffsetEnd,
        );

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
        shadowLineIndex?: LineIndex,
    ): RangeMappingResult {
        // Build LineIndexes once for the whole range mapping
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);
        const shadowIdx = shadowLineIndex ?? new LineIndex(shadow.content);

        const start = shadowPositionToBladePosition(bladeSource, shadow, range.start, bladeIdx, shadowIdx);
        const end = shadowPositionToBladePosition(bladeSource, shadow, range.end, bladeIdx, shadowIdx);

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
        shadowLineIndex?: LineIndex,
    ): RangeMappingResult {
        const bladeIdx = bladeLineIndex ?? new LineIndex(bladeSource);
        const shadowIdx = shadowLineIndex ?? new LineIndex(shadow.content);

        const start = bladePositionToShadowPosition(bladeSource, shadow, range.start, bladeIdx, shadowIdx);
        const end = bladePositionToShadowPosition(bladeSource, shadow, range.end, bladeIdx, shadowIdx);

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
