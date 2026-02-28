import { ParserTypes } from './types';
import { ParserQueryBank } from './query-bank';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;
type QueryCapture = ParserTypes.QueryCapture;

type QueryCaptures = (tree: Tree, querySource: string) => QueryCapture[];

export namespace ParserAst {
    /**
     * Find the deepest node that contains the given position.
     */
    export function findNodeAtPosition(tree: Tree, row: number, column: number): SyntaxNode | null {
        return findNodeAtPositionRecursive(tree.rootNode, row, column);
    }

    /**
     * Collect all directive nodes from the tree.
     */
    export function getAllDirectives(tree: Tree, queryCaptures: QueryCaptures): SyntaxNode[] {
        try {
            return queryCaptures(tree, ParserQueryBank.directives).map((capture) => capture.node);
        } catch {
            const directives: SyntaxNode[] = [];
            collectDirectives(tree.rootNode, directives);
            return directives;
        }
    }

    function findNodeAtPositionRecursive(node: SyntaxNode, row: number, column: number): SyntaxNode | null {
        const start = node.startPosition;
        const end = node.endPosition;

        if (
            row < start.row ||
            row > end.row ||
            (row === start.row && column < start.column) ||
            (row === end.row && column > end.column)
        ) {
            return null;
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;

            const found = findNodeAtPositionRecursive(child, row, column);
            if (found) return found;
        }

        return node;
    }

    function collectDirectives(node: SyntaxNode, directives: SyntaxNode[]): void {
        if (node.type === 'directive' || node.type === 'directive_start' || node.type === 'directive_end') {
            directives.push(node);
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                collectDirectives(child, directives);
            }
        }
    }
}
