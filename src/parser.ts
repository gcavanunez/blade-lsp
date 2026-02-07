/**
 * Tree-sitter based Blade parser.
 *
 * Public API for all tree-sitter operations. Delegates to either the native
 * (node-gyp) or WASM (web-tree-sitter) backend. The backend is selected
 * at initialization time -- all analysis functions are backend-agnostic.
 */

import { ParserTypes } from './parser/types';
import { NativeBackend } from './parser/native';
import { WasmBackend } from './parser/wasm';

export namespace BladeParser {
    export type SyntaxNode = ParserTypes.SyntaxNode;
    export type Tree = ParserTypes.Tree;

    let backend: ParserTypes.Backend | null = null;

    /**
     * Initialize the parser with the chosen backend.
     * Defaults to 'wasm' for portable npm distribution.
     */
    export async function initialize(type: 'native' | 'wasm' = 'wasm'): Promise<void> {
        backend = type === 'native' ? NativeBackend.create() : WasmBackend.create();
        await backend.initialize();
    }

    /**
     * Parse a Blade template and return the syntax tree.
     */
    export function parse(source: string): Tree {
        if (!backend) {
            throw new Error('BladeParser not initialized. Call initialize() first.');
        }
        return backend.parse(source);
    }

    /**
     * Extract the directive name from a node.
     */
    export function extractDirectiveName(node: SyntaxNode): string | null {
        const text = node.text;
        const match = text.match(/^@(\w+)/);
        return match ? `@${match[1]}` : null;
    }

    /**
     * Find the node at a given position in the tree.
     */
    export function findNodeAtPosition(tree: Tree, row: number, column: number): SyntaxNode | null {
        return findNodeAtPositionRecursive(tree.rootNode, row, column);
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
            if (child) {
                const found = findNodeAtPositionRecursive(child, row, column);
                if (found) {
                    return found;
                }
            }
        }

        return node;
    }

    /**
     * Get all directive nodes from the tree.
     */
    export function getAllDirectives(tree: Tree): SyntaxNode[] {
        const directives: SyntaxNode[] = [];
        collectDirectives(tree.rootNode, directives);
        return directives;
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

    /**
     * Check if a position is inside a directive parameter.
     */
    export function isInsideDirectiveParameter(tree: Tree, row: number, column: number): boolean {
        const node = findNodeAtPosition(tree, row, column);
        if (!node) return false;

        let current: SyntaxNode | null = node;
        while (current) {
            if (
                current.type === 'parameter' ||
                current.type === 'bracket_parameter' ||
                current.type === 'directive_parameter'
            ) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    /**
     * Check if a position is inside an echo statement.
     */
    export function isInsideEcho(tree: Tree, row: number, column: number): boolean {
        const node = findNodeAtPosition(tree, row, column);
        if (!node) return false;

        let current: SyntaxNode | null = node;
        while (current) {
            if (
                current.type === 'echo_statement' ||
                current.type === 'escaped_echo_statement' ||
                current.type === 'unescaped_echo_statement' ||
                current.type === 'php_only'
            ) {
                return true;
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

    export function getCompletionContext(tree: Tree, source: string, row: number, column: number): CompletionContext {
        const node = findNodeAtPosition(tree, row, column);
        const lines = source.split('\n');
        const currentLine = lines[row] || '';
        const textBeforeCursor = currentLine.slice(0, column);

        // Check for @ directive trigger
        const directiveMatch = textBeforeCursor.match(/@(\w*)$/);
        if (directiveMatch) {
            return {
                type: 'directive',
                prefix: directiveMatch[0],
                node,
            };
        }

        // Check if inside echo
        if (node && isInsideEcho(tree, row, column)) {
            return {
                type: 'echo',
                prefix: '',
                node,
            };
        }

        // Check if inside a directive parameter
        if (node && isInsideDirectiveParameter(tree, row, column)) {
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

        // Check if inside a comment
        if (node?.type === 'comment') {
            return {
                type: 'comment',
                prefix: '',
                node,
            };
        }

        // Check if inside PHP block
        if (node?.type === 'php' || node?.type === 'php_only') {
            return {
                type: 'php',
                prefix: '',
                node,
            };
        }

        return {
            type: 'html',
            prefix: '',
            node,
        };
    }

    /**
     * Diagnostic information.
     */
    interface DiagnosticInfo {
        message: string;
        startPosition: { row: number; column: number };
        endPosition: { row: number; column: number };
        severity: 'error' | 'warning' | 'info';
    }

    /**
     * Get diagnostics from the parse tree.
     */
    export function getDiagnostics(tree: Tree): DiagnosticInfo[] {
        const diagnostics: DiagnosticInfo[] = [];
        checkForErrors(tree.rootNode, diagnostics);
        return diagnostics;
    }

    function checkForErrors(node: SyntaxNode, diagnostics: DiagnosticInfo[]): void {
        if (node.hasError) {
            if (node.isMissing) {
                diagnostics.push({
                    message: `Missing ${node.type}`,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                    severity: 'error',
                });
            } else if (node.type === 'ERROR') {
                diagnostics.push({
                    message: 'Syntax error',
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                    severity: 'error',
                });
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                checkForErrors(child, diagnostics);
            }
        }
    }

    /**
     * Debug: Print the AST structure.
     */
    export function printTree(tree: Tree): string {
        return tree.rootNode.toString();
    }

    /**
     * Debug: Print node info recursively.
     */
    export function printNode(node: SyntaxNode, indent = 0): void {
        const prefix = '  '.repeat(indent);
        console.log(`${prefix}${node.type}: "${node.text.slice(0, 50).replace(/\n/g, '\\n')}"`);
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                printNode(child, indent + 1);
            }
        }
    }
}
