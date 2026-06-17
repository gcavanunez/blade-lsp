import { Position, Range } from 'vscode-languageserver/node';
import { PhpBridgeShadowDocument } from './shadow-document';

export namespace PhpBridgeMapping {
    export type MappingKind = 'mapped' | 'synthetic' | 'unmappable';

    export type PositionMappingResult =
        | { kind: 'mapped'; position: Position; regionId: string }
        | { kind: 'synthetic' | 'unmappable' };

    export type RangeMappingResult =
        | { kind: 'mapped'; range: Range; regionId: string }
        | { kind: 'synthetic' | 'unmappable' };

    export function offsetToPosition(source: string, offset: number): Position {
        const safeOffset = Math.max(0, Math.min(offset, source.length));
        const before = source.slice(0, safeOffset);
        const parts = before.split('\n');

        return Position.create(parts.length - 1, parts[parts.length - 1]?.length ?? 0);
    }

    export function positionToOffset(source: string, position: Position): number {
        const lines = source.split('\n');
        let offset = 0;
        const targetLine = Math.max(0, Math.min(position.line, lines.length - 1));

        for (let line = 0; line < targetLine; line++) {
            offset += lines[line].length + 1;
        }

        return offset + Math.max(0, Math.min(position.character, lines[targetLine]?.length ?? 0));
    }

    export function bladePositionToShadowPosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
    ): PositionMappingResult {
        const bladeOffset = positionToOffset(bladeSource, position);
        const region = shadow.regions.find(
            (item) => bladeOffset >= item.bladeContentOffsetStart && bladeOffset <= item.bladeContentOffsetEnd,
        );

        if (!region) {
            return { kind: 'unmappable' };
        }

        const shadowOffset = region.shadowContentOffsetStart + (bladeOffset - region.bladeContentOffsetStart);
        return {
            kind: 'mapped',
            regionId: region.id,
            position: offsetToPosition(shadow.content, shadowOffset),
        };
    }

    export function shadowPositionToBladePosition(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        position: Position,
    ): PositionMappingResult {
        const shadowOffset = positionToOffset(shadow.content, position);
        const region = shadow.regions.find(
            (item) => shadowOffset >= item.shadowContentOffsetStart && shadowOffset <= item.shadowContentOffsetEnd,
        );

        if (region) {
            const bladeOffset = region.bladeContentOffsetStart + (shadowOffset - region.shadowContentOffsetStart);
            return {
                kind: 'mapped',
                regionId: region.id,
                position: offsetToPosition(bladeSource, bladeOffset),
            };
        }

        const maxShadowOffset = shadow.regions.reduce((max, item) => Math.max(max, item.shadowContentOffsetEnd), 0);
        return { kind: shadowOffset <= maxShadowOffset ? 'synthetic' : 'unmappable' };
    }

    export function shadowRangeToBladeRange(
        bladeSource: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        range: Range,
    ): RangeMappingResult {
        const start = shadowPositionToBladePosition(bladeSource, shadow, range.start);
        const end = shadowPositionToBladePosition(bladeSource, shadow, range.end);

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
    ): RangeMappingResult {
        const start = bladePositionToShadowPosition(bladeSource, shadow, range.start);
        const end = bladePositionToShadowPosition(bladeSource, shadow, range.end);

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
