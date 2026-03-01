import { ParserTypes } from './types';

type EditableTree = ParserTypes.Tree & {
    edit?: (edit: ParserTypes.TreeEdit) => void;
};

export namespace ParserIncremental {
    export function computeEdit(oldText: string, newText: string): ParserTypes.TreeEdit | null {
        if (oldText === newText) {
            return null;
        }

        let startIndex = 0;
        const minLength = Math.min(oldText.length, newText.length);
        while (startIndex < minLength && oldText.charCodeAt(startIndex) === newText.charCodeAt(startIndex)) {
            startIndex++;
        }

        let oldEndIndex = oldText.length;
        let newEndIndex = newText.length;
        while (
            oldEndIndex > startIndex &&
            newEndIndex > startIndex &&
            oldText.charCodeAt(oldEndIndex - 1) === newText.charCodeAt(newEndIndex - 1)
        ) {
            oldEndIndex--;
            newEndIndex--;
        }

        return {
            startIndex,
            oldEndIndex,
            newEndIndex,
            startPosition: indexToPosition(oldText, startIndex),
            oldEndPosition: indexToPosition(oldText, oldEndIndex),
            newEndPosition: indexToPosition(newText, newEndIndex),
        };
    }

    export function applyEdit(tree: ParserTypes.Tree, edit: ParserTypes.TreeEdit): boolean {
        const editableTree = tree as EditableTree;
        if (typeof editableTree.edit !== 'function') {
            return false;
        }

        editableTree.edit(edit);
        return true;
    }

    function indexToPosition(text: string, index: number): ParserTypes.Position {
        let row = 0;
        let column = 0;

        for (let i = 0; i < index; i++) {
            if (text.charCodeAt(i) === 10) {
                row++;
                column = 0;
            } else {
                column++;
            }
        }

        return { row, column };
    }
}
