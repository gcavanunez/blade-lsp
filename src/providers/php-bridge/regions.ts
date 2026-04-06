import { Position } from 'vscode-languageserver/node';
import { LineIndex } from '../../utils/line-index';
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
                start: lexed.lineIndex.offsetToPosition(contentOffsets.contentOffsetStart),
                end: lexed.lineIndex.offsetToPosition(contentOffsets.contentOffsetEnd),
                content: source.slice(contentOffsets.contentOffsetStart, contentOffsets.contentOffsetEnd),
            });
        }

        return { lexed, regions, signature: getSignature(regions) };
    }

    /**
     * Find the region containing `offset` by content offsets.
     * O(log n) binary search — regions are sorted by offset.
     */
    export function getRegionAtOffset(regions: Region[], offset: number): Region | null {
        let lo = 0;
        let hi = regions.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const r = regions[mid];
            if (offset < r.contentOffsetStart) {
                hi = mid - 1;
            } else if (offset > r.contentOffsetEnd) {
                lo = mid + 1;
            } else {
                return r;
            }
        }
        return null;
    }

    export function getRegionAtPosition(
        source: string,
        regions: Region[],
        position: Position,
        lineIndex?: LineIndex,
    ): Region | null {
        const idx = lineIndex ?? new LineIndex(source);
        return getRegionAtOffset(regions, idx.positionToOffset(position));
    }
}
