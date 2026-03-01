import { beforeAll, describe, expect, it } from 'vitest';
import { BladeParser } from '../../src/parser';
import { ParserIncremental } from '../../src/parser/incremental';
import { ensureContainer } from '../utils/laravel-mock';

describe('ParserIncremental', () => {
    beforeAll(async () => {
        ensureContainer();
        await BladeParser.initialize();
    });

    it('returns null when text is unchanged', () => {
        expect(ParserIncremental.computeEdit('same', 'same')).toBeNull();
    });

    it('computes an edit that transforms old text into new text', () => {
        const oldText = 'line one\nline two\nline three';
        const newText = 'line one\nline two updated\nline three';
        const edit = ParserIncremental.computeEdit(oldText, newText);

        expect(edit).not.toBeNull();
        if (!edit) return;

        const reconstructed =
            oldText.slice(0, edit.startIndex) +
            newText.slice(edit.startIndex, edit.newEndIndex) +
            oldText.slice(edit.oldEndIndex);

        expect(reconstructed).toBe(newText);
    });

    it('computes row/column positions for multi-line edits', () => {
        const oldText = 'alpha\nbeta\ngamma';
        const newText = 'alpha\nBETA\ngamma';
        const edit = ParserIncremental.computeEdit(oldText, newText);

        expect(edit).not.toBeNull();
        if (!edit) return;

        expect(edit.startPosition).toEqual({ row: 1, column: 0 });
        expect(edit.oldEndPosition).toEqual({ row: 1, column: 4 });
        expect(edit.newEndPosition).toEqual({ row: 1, column: 4 });
    });

    it('returns false when tree does not support edits', () => {
        const edit = ParserIncremental.computeEdit('a', 'b');
        expect(edit).not.toBeNull();
        if (!edit) return;

        const tree = {
            rootNode: {
                text: '',
                type: 'document',
                startPosition: { row: 0, column: 0 },
                endPosition: { row: 0, column: 0 },
                childCount: 0,
                child: () => null,
                parent: null,
                hasError: false,
                isMissing: false,
                toString: () => '(document)',
            },
        };

        expect(ParserIncremental.applyEdit(tree, edit)).toBe(false);
    });

    it('produces the same parse tree with incremental parsing', () => {
        const oldSource = '<div>{{ $name }}</div>\n@if($active)\n<span>active</span>\n@endif';
        const newSource = '<div>{{ $fullName }}</div>\n@if($active)\n<span>active</span>\n@endif';

        const oldTree = BladeParser.parse(oldSource);
        const edit = ParserIncremental.computeEdit(oldSource, newSource);

        expect(edit).not.toBeNull();
        if (!edit) return;

        expect(ParserIncremental.applyEdit(oldTree, edit)).toBe(true);

        const incrementalTree = BladeParser.parse(newSource, oldTree);
        const fullTree = BladeParser.parse(newSource);

        expect(incrementalTree.rootNode.toString()).toBe(fullTree.rootNode.toString());
    });
});
