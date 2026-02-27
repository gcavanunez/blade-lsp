import { ParserTypes } from './types';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;
type FindNodeAtPosition = (tree: Tree, row: number, column: number) => SyntaxNode | null;

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
    ): boolean {
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
    ): boolean {
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

        if (node && isInsideEcho(tree, row, column, findNodeAtPosition)) {
            return {
                type: 'echo',
                prefix: '',
                node,
            };
        }

        if (node && isInsideDirectiveParameter(tree, row, column, findNodeAtPosition)) {
            let directiveName: string | undefined;
            let current: SyntaxNode | null = node;
            while (current) {
                const name = extractDirectiveName(current);
                if (name) {
                    directiveName = name.slice(1);
                    break;
                }
                current = current.parent;
            }

            return {
                type: 'parameter',
                prefix: '',
                node,
                directiveName,
            };
        }

        if (node?.type === 'comment') {
            return {
                type: 'comment',
                prefix: '',
                node,
            };
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
