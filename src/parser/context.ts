import { ParserTypes } from './types';
import { ParserQueryBank } from './query-bank';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;
type QueryCapture = ParserTypes.QueryCapture;

type FindNodeAtPosition = (tree: Tree, row: number, column: number) => SyntaxNode | null;
type QueryCaptures = (tree: Tree, querySource: string, node?: SyntaxNode) => QueryCapture[];

function isPositionWithinNode(node: SyntaxNode, row: number, column: number): boolean {
    if (row < node.startPosition.row || row > node.endPosition.row) return false;
    if (row === node.startPosition.row && column < node.startPosition.column) return false;
    if (row === node.endPosition.row && column > node.endPosition.column) return false;
    return true;
}

function isStrictlyNarrowerRange(a: SyntaxNode, b: SyntaxNode): boolean {
    if (a.startPosition.row !== b.startPosition.row) return a.startPosition.row > b.startPosition.row;
    if (a.startPosition.column !== b.startPosition.column) return a.startPosition.column > b.startPosition.column;
    if (a.endPosition.row !== b.endPosition.row) return a.endPosition.row < b.endPosition.row;
    return a.endPosition.column < b.endPosition.column;
}

function findNarrowestCaptureAtPosition(
    tree: Tree,
    row: number,
    column: number,
    querySource: string,
    queryCaptures?: QueryCaptures,
): SyntaxNode | null {
    if (!queryCaptures) return null;

    try {
        let best: SyntaxNode | null = null;
        for (const capture of queryCaptures(tree, querySource)) {
            if (!isPositionWithinNode(capture.node, row, column)) continue;
            if (!best || isStrictlyNarrowerRange(capture.node, best)) {
                best = capture.node;
            }
        }
        return best;
    } catch {
        return null;
    }
}

export namespace ParserContext {
    /**
     * Extract the directive name from a node.
     */
    export function extractDirectiveName(node: SyntaxNode): string | null {
        const text = node.text;
        const match = text.match(/^@(\w+)/);
        return match ? `@${match[1]}` : null;
    }

    /**
     * Check if a position is inside a directive parameter.
     */
    export function isInsideDirectiveParameter(
        tree: Tree,
        row: number,
        column: number,
        findNodeAtPosition: FindNodeAtPosition,
        queryCaptures?: QueryCaptures,
    ): boolean {
        const parameterNode = findNarrowestCaptureAtPosition(
            tree,
            row,
            column,
            ParserQueryBank.parameter,
            queryCaptures,
        );
        if (parameterNode) {
            return true;
        }

        const node = findNodeAtPosition(tree, row, column);
        if (!node) return false;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'parameter') {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    /**
     * Check if a position is inside an echo statement.
     */
    export function isInsideEcho(
        tree: Tree,
        row: number,
        column: number,
        findNodeAtPosition: FindNodeAtPosition,
        queryCaptures?: QueryCaptures,
    ): boolean {
        const phpOnlyNode = findNarrowestCaptureAtPosition(tree, row, column, ParserQueryBank.phpOnly, queryCaptures);
        if (phpOnlyNode) {
            return true;
        }

        if (queryCaptures) {
            try {
                for (const capture of queryCaptures(tree, ParserQueryBank.phpStatement)) {
                    if (!isPositionWithinNode(capture.node, row, column)) continue;

                    const firstChild = capture.node.child(0);
                    if (firstChild && (firstChild.type === '{{' || firstChild.type === '{!!')) {
                        return true;
                    }
                }
            } catch {
                // Fall back to ancestor traversal.
            }
        }

        const node = findNodeAtPosition(tree, row, column);
        if (!node) return false;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'php_only') {
                return true;
            }
            if (current.type === 'php_statement') {
                const firstChild = current.child(0);
                if (firstChild && (firstChild.type === '{{' || firstChild.type === '{!!')) {
                    return true;
                }
            }
            current = current.parent;
        }
        return false;
    }

    /**
     * Get the context at a given position for completion.
     */
    export interface CompletionContext {
        type: 'directive' | 'echo' | 'parameter' | 'html' | 'comment' | 'php';
        prefix: string;
        node: SyntaxNode | null;
        directiveName?: string;
    }

    export function getCompletionContext(
        tree: Tree,
        source: string,
        row: number,
        column: number,
        findNodeAtPosition: FindNodeAtPosition,
        queryCaptures?: QueryCaptures,
    ): CompletionContext {
        const node = findNodeAtPosition(tree, row, column);
        const lines = source.split('\n');
        const currentLine = lines[row] || '';
        const textBeforeCursor = currentLine.slice(0, column);

        const directiveMatch = textBeforeCursor.match(/@(\w*)$/);
        if (directiveMatch) {
            return {
                type: 'directive',
                prefix: directiveMatch[0],
                node,
            };
        }

        if (node && isInsideEcho(tree, row, column, findNodeAtPosition, queryCaptures)) {
            return {
                type: 'echo',
                prefix: '',
                node,
            };
        }

        if (node && isInsideDirectiveParameter(tree, row, column, findNodeAtPosition, queryCaptures)) {
            let directiveName: string | undefined;

            if (queryCaptures) {
                try {
                    let best: SyntaxNode | null = null;
                    for (const capture of queryCaptures(tree, ParserQueryBank.directiveNodes)) {
                        if (!isPositionWithinNode(capture.node, row, column)) continue;
                        if (!best || isStrictlyNarrowerRange(capture.node, best)) {
                            best = capture.node;
                        }
                    }

                    if (best) {
                        const name = extractDirectiveName(best);
                        if (name) {
                            directiveName = name.slice(1);
                        }
                    }
                } catch {
                    // Fall through to ancestry walk.
                }
            }

            if (!directiveName) {
                let current: SyntaxNode | null = node;
                while (current) {
                    const name = extractDirectiveName(current);
                    if (name) {
                        directiveName = name.slice(1);
                        break;
                    }
                    current = current.parent;
                }
            }

            return {
                type: 'parameter',
                prefix: '',
                node,
                directiveName,
            };
        }

        const commentNode = findNarrowestCaptureAtPosition(tree, row, column, ParserQueryBank.comment, queryCaptures);
        if (commentNode || node?.type === 'comment') {
            return {
                type: 'comment',
                prefix: '',
                node: commentNode ?? node,
            };
        }

        const phpOnlyNode = findNarrowestCaptureAtPosition(tree, row, column, ParserQueryBank.phpOnly, queryCaptures);
        if (phpOnlyNode) {
            const parent = phpOnlyNode.parent;
            if (parent?.type === 'php_statement') {
                const firstChild = parent.child(0);
                if (firstChild?.type === 'directive_start' || firstChild?.type === 'php_tag') {
                    return {
                        type: 'php',
                        prefix: '',
                        node: phpOnlyNode,
                    };
                }
            }
        }

        if (node?.type === 'php_only') {
            const parent = node.parent;
            if (parent?.type === 'php_statement') {
                const firstChild = parent.child(0);
                if (firstChild?.type === 'directive_start' || firstChild?.type === 'php_tag') {
                    return {
                        type: 'php',
                        prefix: '',
                        node,
                    };
                }
            }
        }

        return {
            type: 'html',
            prefix: '',
            node,
        };
    }
}
