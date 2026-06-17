import { describe, it, expect } from 'vitest';
import { LineIndex } from '../../src/utils/line-index';

describe('LineIndex', () => {
    describe('constructor', () => {
        it('counts lines correctly for multi-line string', () => {
            const idx = new LineIndex('aaa\nbbb\nccc');
            expect(idx.lineCount).toBe(3);
        });

        it('counts single line (no newlines)', () => {
            const idx = new LineIndex('hello');
            expect(idx.lineCount).toBe(1);
        });

        it('counts empty string as one line', () => {
            const idx = new LineIndex('');
            expect(idx.lineCount).toBe(1);
        });

        it('counts trailing newline as extra empty line', () => {
            const idx = new LineIndex('aaa\n');
            expect(idx.lineCount).toBe(2);
        });

        it('counts multiple trailing newlines', () => {
            const idx = new LineIndex('a\n\n\n');
            expect(idx.lineCount).toBe(4);
        });
    });

    describe('offsetToPosition', () => {
        const source = 'abc\ndef\nghi';
        //               0123 4567 89..
        const idx = new LineIndex(source);

        it('maps offset 0 to line 0, char 0', () => {
            expect(idx.offsetToPosition(0)).toEqual({ line: 0, character: 0 });
        });

        it('maps offset within first line', () => {
            expect(idx.offsetToPosition(2)).toEqual({ line: 0, character: 2 });
        });

        it('maps offset at newline boundary to end of line', () => {
            // offset 3 is the '\n' after "abc"
            expect(idx.offsetToPosition(3)).toEqual({ line: 0, character: 3 });
        });

        it('maps offset at start of second line', () => {
            expect(idx.offsetToPosition(4)).toEqual({ line: 1, character: 0 });
        });

        it('maps offset within second line', () => {
            expect(idx.offsetToPosition(5)).toEqual({ line: 1, character: 1 });
        });

        it('maps offset at start of third line', () => {
            expect(idx.offsetToPosition(8)).toEqual({ line: 2, character: 0 });
        });

        it('maps offset at end of source', () => {
            expect(idx.offsetToPosition(11)).toEqual({ line: 2, character: 3 });
        });

        it('clamps negative offset to start', () => {
            expect(idx.offsetToPosition(-5)).toEqual({ line: 0, character: 0 });
        });

        it('clamps offset past end to end of last line', () => {
            expect(idx.offsetToPosition(999)).toEqual({ line: 2, character: 3 });
        });
    });

    describe('positionToOffset', () => {
        const source = 'abc\ndef\nghi';
        const idx = new LineIndex(source);

        it('maps line 0, char 0 to offset 0', () => {
            expect(idx.positionToOffset({ line: 0, character: 0 })).toBe(0);
        });

        it('maps line 0, char 2 to offset 2', () => {
            expect(idx.positionToOffset({ line: 0, character: 2 })).toBe(2);
        });

        it('maps line 1, char 0 to offset 4', () => {
            expect(idx.positionToOffset({ line: 1, character: 0 })).toBe(4);
        });

        it('maps line 2, char 2 to offset 10', () => {
            expect(idx.positionToOffset({ line: 2, character: 2 })).toBe(10);
        });

        it('clamps line past end to last line', () => {
            expect(idx.positionToOffset({ line: 99, character: 0 })).toBe(8);
        });
    });

    describe('round-trip: offset -> position -> offset', () => {
        const sources = [
            '',
            'single line no newline',
            'trailing newline\n',
            'line1\nline2\nline3',
            'a\nb\nc\nd\ne\n',
            '@if($user)\n    <p>{{ $user->name }}</p>\n@endif',
        ];

        for (const source of sources) {
            it(`round-trips all offsets for: "${source.slice(0, 30)}..."`, () => {
                const idx = new LineIndex(source);
                for (let offset = 0; offset <= source.length; offset++) {
                    const pos = idx.offsetToPosition(offset);
                    const back = idx.positionToOffset(pos);
                    expect(back).toBe(offset);
                }
            });
        }
    });

    describe('getLineText', () => {
        const idx = new LineIndex('abc\ndef\nghi');

        it('returns first line text', () => {
            expect(idx.getLineText(0)).toBe('abc');
        });

        it('returns middle line text', () => {
            expect(idx.getLineText(1)).toBe('def');
        });

        it('returns last line text', () => {
            expect(idx.getLineText(2)).toBe('ghi');
        });

        it('returns empty string for out-of-bounds line', () => {
            expect(idx.getLineText(-1)).toBe('');
            expect(idx.getLineText(99)).toBe('');
        });

        it('returns empty string for empty trailing line', () => {
            const idx2 = new LineIndex('abc\n');
            expect(idx2.getLineText(0)).toBe('abc');
            expect(idx2.getLineText(1)).toBe('');
        });
    });

    describe('getLineStart / getLineEnd', () => {
        const idx = new LineIndex('abc\ndef\nghi');

        it('returns correct start offsets', () => {
            expect(idx.getLineStart(0)).toBe(0);
            expect(idx.getLineStart(1)).toBe(4);
            expect(idx.getLineStart(2)).toBe(8);
        });

        it('returns correct end offsets', () => {
            expect(idx.getLineEnd(0)).toBe(3); // 'abc' ends at 3 (before \n)
            expect(idx.getLineEnd(1)).toBe(7); // 'def' ends at 7
            expect(idx.getLineEnd(2)).toBe(11); // 'ghi' ends at 11 (source.length)
        });
    });

    describe('lines (lazy getter)', () => {
        it('returns same result as split', () => {
            const source = 'abc\ndef\nghi';
            const idx = new LineIndex(source);
            expect(idx.lines).toEqual(source.split('\n'));
        });

        it('returns same array instance on repeated access', () => {
            const idx = new LineIndex('a\nb');
            const first = idx.lines;
            const second = idx.lines;
            expect(first).toBe(second);
        });

        it('handles trailing newline same as split', () => {
            const source = 'abc\n';
            const idx = new LineIndex(source);
            expect(idx.lines).toEqual(source.split('\n'));
        });
    });

    describe('consistency with split-based approach', () => {
        // Verify LineIndex produces identical results to the old split approach
        const sources = [
            '<div>\n@if($x)\n    {{ $x }}\n@endif\n</div>',
            "@extends('layouts.app')\n\n@section('content')\n    <h1>Title</h1>\n@endsection",
            '<?php\n$x = 1;\n?>\n<p>{{ $x }}</p>',
        ];

        for (const source of sources) {
            it(`matches split behavior for: "${source.slice(0, 40)}..."`, () => {
                const idx = new LineIndex(source);
                const splitLines = source.split('\n');

                expect(idx.lineCount).toBe(splitLines.length);

                for (let i = 0; i < splitLines.length; i++) {
                    expect(idx.getLineText(i)).toBe(splitLines[i]);
                }
            });
        }
    });
});
