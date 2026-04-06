import { Position } from 'vscode-languageserver/node';

/**
 * Pre-computed line offset index for O(log n) offset↔position conversion.
 *
 * Scans the source string once on construction to record where each line
 * starts. All subsequent lookups are O(log n) binary searches or O(1)
 * direct array access — no `split('\n')` calls.
 *
 * For sites that need the full `string[]` of lines (e.g., iterating every
 * line for diagnostics), a lazy `.lines` getter splits once and caches.
 */
export class LineIndex {
    /** Byte offset where each line starts. `lineStarts[0]` is always `0`. */
    private readonly lineStarts: Uint32Array;

    /** Lazily-computed full lines array (only allocated on first `.lines` access). */
    private _lines: string[] | null = null;

    /** Total number of lines in the source. */
    readonly lineCount: number;

    /** The original source string. */
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

    /**
     * Convert a byte offset to a `{ line, character }` Position.
     *
     * O(log n) — binary search over `lineStarts`.
     */
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

    /**
     * Convert a `{ line, character }` Position to a byte offset.
     *
     * O(1) — direct array lookup.
     */
    positionToOffset(position: Position): number {
        const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
        return this.lineStarts[line] + position.character;
    }

    /**
     * Get the start offset of a given line.
     *
     * O(1) — direct array lookup.
     */
    getLineStart(line: number): number {
        if (line < 0 || line >= this.lineCount) return 0;
        return this.lineStarts[line];
    }

    /**
     * Get the end offset of a given line (excludes the trailing `\n`).
     *
     * O(1) — direct array lookup.
     */
    getLineEnd(line: number): number {
        if (line < 0 || line >= this.lineCount) return 0;
        if (line + 1 < this.lineCount) {
            return this.lineStarts[line + 1] - 1;
        }
        return this.source.length;
    }

    /**
     * Get the text of a single line (without trailing newline).
     *
     * O(1) offset lookup + O(k) string slice where k = line length.
     */
    getLineText(line: number): string {
        if (line < 0 || line >= this.lineCount) return '';
        const start = this.lineStarts[line];
        const end = this.getLineEnd(line);
        return this.source.slice(start, end);
    }

    /**
     * Full lines array, lazily computed.
     *
     * Use this for sites that iterate every line. The array is split once
     * and cached for the lifetime of this `LineIndex` instance.
     */
    get lines(): string[] {
        if (this._lines === null) {
            this._lines = this.source.split('\n');
        }
        return this._lines;
    }
}
