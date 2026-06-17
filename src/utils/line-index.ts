import { Position } from 'vscode-languageserver/node';

/**
 * Pre-computed line offset index for O(log n) offset/position conversion.
 *
 * Scans the source once on construction to record line-start offsets.
 * Lazy `.lines` getter splits once and caches for full-iteration sites.
 */
export class LineIndex {
    private readonly lineStarts: Uint32Array;
    private _lines: string[] | null = null;
    readonly lineCount: number;
    readonly source: string;

    constructor(source: string) {
        this.source = source;

        const starts: number[] = [0];
        for (let i = 0; i < source.length; i++) {
            if (source.charCodeAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        this.lineStarts = new Uint32Array(starts);
        this.lineCount = starts.length;
    }

    offsetToPosition(offset: number): Position {
        const clamped = Math.max(0, Math.min(offset, this.source.length));

        let lo = 0;
        let hi = this.lineCount - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.lineStarts[mid] <= clamped) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        return Position.create(lo, clamped - this.lineStarts[lo]);
    }

    positionToOffset(position: Position): number {
        const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
        return this.lineStarts[line] + position.character;
    }

    getLineStart(line: number): number {
        if (line < 0 || line >= this.lineCount) return 0;
        return this.lineStarts[line];
    }

    getLineEnd(line: number): number {
        if (line < 0 || line >= this.lineCount) return 0;
        if (line + 1 < this.lineCount) {
            return this.lineStarts[line + 1] - 1;
        }
        return this.source.length;
    }

    getLineText(line: number): string {
        if (line < 0 || line >= this.lineCount) return '';
        const start = this.lineStarts[line];
        const end = this.getLineEnd(line);
        return this.source.slice(start, end);
    }

    get lines(): string[] {
        if (this._lines === null) {
            this._lines = this.source.split('\n');
        }
        return this._lines;
    }
}
