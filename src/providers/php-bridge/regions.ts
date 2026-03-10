import { Position } from 'vscode-languageserver/node';
import { Lexer } from '../../parser/lexer';

export namespace PhpBridgeRegions {
    export type RegionKind = 'php-tag' | 'blade-directive';

    export interface Region {
        id: string;
        kind: RegionKind;
        rawOffsetStart: number;
        rawOffsetEnd: number;
        contentOffsetStart: number;
        contentOffsetEnd: number;
        start: Position;
        end: Position;
        content: string;
    }

    export interface RegionExtraction {
        lexed: Lexer.LexedSource;
        regions: Region[];
        signature: string;
    }

    function offsetToPosition(source: string, offset: number): Position {
        const safeOffset = Math.max(0, Math.min(offset, source.length));
        const before = source.slice(0, safeOffset);
        const parts = before.split('\n');

        return Position.create(parts.length - 1, parts[parts.length - 1]?.length ?? 0);
    }

    function positionToOffset(source: string, position: Position): number {
        const lines = source.split('\n');
        let offset = 0;
        const targetLine = Math.max(0, Math.min(position.line, lines.length - 1));

        for (let line = 0; line < targetLine; line++) {
            offset += lines[line].length + 1;
        }

        return offset + Math.max(0, Math.min(position.character, lines[targetLine]?.length ?? 0));
    }

    function getPhpTagContentOffsets(
        source: string,
        rawOffsetStart: number,
        rawOffsetEnd: number,
    ): {
        contentOffsetStart: number;
        contentOffsetEnd: number;
    } {
        const raw = source.slice(rawOffsetStart, rawOffsetEnd);
        const openMatch = raw.match(/^<\?(?:php|=)?/);
        const openLength = openMatch?.[0].length ?? 2;
        const closeLength = raw.endsWith('?>') ? 2 : 0;

        return {
            contentOffsetStart: rawOffsetStart + openLength,
            contentOffsetEnd: Math.max(rawOffsetStart + openLength, rawOffsetEnd - closeLength),
        };
    }

    export function getSignature(regions: Region[]): string {
        return regions.map((region) => `${region.kind}:${region.content}`).join('\n/* region-break */\n');
    }

    export function extract(source: string, lexed: Lexer.LexedSource = Lexer.lexSource(source)): RegionExtraction {
        const regions: Region[] = [];

        for (let index = 0; index < lexed.phpRanges.length; index++) {
            const range = lexed.phpRanges[index];
            const kind: RegionKind =
                source.slice(range.offsetStart, range.offsetStart + 2) === '<?' ? 'php-tag' : 'blade-directive';
            const contentOffsets =
                kind === 'php-tag'
                    ? getPhpTagContentOffsets(source, range.offsetStart, range.offsetEnd)
                    : {
                          contentOffsetStart: range.offsetStart,
                          contentOffsetEnd: range.offsetEnd,
                      };

            regions.push({
                id: `blade-region:${index + 1}`,
                kind,
                rawOffsetStart: range.offsetStart,
                rawOffsetEnd: range.offsetEnd,
                contentOffsetStart: contentOffsets.contentOffsetStart,
                contentOffsetEnd: contentOffsets.contentOffsetEnd,
                start: offsetToPosition(source, contentOffsets.contentOffsetStart),
                end: offsetToPosition(source, contentOffsets.contentOffsetEnd),
                content: source.slice(contentOffsets.contentOffsetStart, contentOffsets.contentOffsetEnd),
            });
        }

        return { lexed, regions, signature: getSignature(regions) };
    }

    export function getRegionAtOffset(regions: Region[], offset: number): Region | null {
        return (
            regions.find((region) => offset >= region.contentOffsetStart && offset <= region.contentOffsetEnd) ?? null
        );
    }

    export function getRegionAtPosition(source: string, regions: Region[], position: Position): Region | null {
        return getRegionAtOffset(regions, positionToOffset(source, position));
    }
}
