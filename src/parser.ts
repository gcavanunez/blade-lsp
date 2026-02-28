/**
 * Tree-sitter based Blade parser.
 *
 * Public API for all tree-sitter operations. Delegates to either the native
 * (node-gyp) or WASM (web-tree-sitter) backend. The backend is selected
 * at initialization time -- all analysis functions are backend-agnostic.
 */

import { MutableRef } from 'effect';
import { ParserTypes } from './parser/types';
import { NativeBackend } from './parser/native';
import { WasmBackend } from './parser/wasm';
import { ParserContext } from './parser/context';
import { ParserComponents } from './parser/components';
import { ParserDiagnostics } from './parser/diagnostics';
import { ParserAst } from './parser/ast';
import { Container } from './runtime/container';

export namespace BladeParser {
    export type SyntaxNode = ParserTypes.SyntaxNode;
    export type Tree = ParserTypes.Tree;
    export type QueryCapture = ParserTypes.QueryCapture;

    const queryCache = new Map<string, ParserTypes.CompiledQuery>();

    /**
     * Initialize the parser with the chosen backend.
     * Defaults to 'wasm' for portable npm distribution.
     *
     * Stores the backend in the service container's `parserBackend` MutableRef.
     */
    export async function initialize(type: 'native' | 'wasm' = 'wasm'): Promise<void> {
        const backend = type === 'native' ? NativeBackend.create() : WasmBackend.create();
        await backend.initialize();
        MutableRef.set(Container.get().parserBackend, backend);
        queryCache.clear();
    }

    /**
     * Parse a Blade template and return the syntax tree.
     */
    export function parse(source: string): Tree {
        const backend = MutableRef.get(Container.get().parserBackend);
        if (!backend) {
            throw new Error('BladeParser not initialized. Call initialize() first.');
        }
        return backend.parse(source);
    }

    function getQueryCaptures(tree: Tree, querySource: string, node: SyntaxNode = tree.rootNode): QueryCapture[] {
        const backend = MutableRef.get(Container.get().parserBackend);
        if (!backend) {
            throw new Error('BladeParser not initialized. Call initialize() first.');
        }

        const compiled = queryCache.get(querySource) ?? backend.compileQuery(querySource);
        queryCache.set(querySource, compiled);

        return compiled.captures(node);
    }

    /**
     * Extract the directive name from a node.
     */
    export function extractDirectiveName(node: SyntaxNode): string | null {
        return ParserContext.extractDirectiveName(node);
    }

    /**
     * Find the node at a given position in the tree.
     */
    export function findNodeAtPosition(tree: Tree, row: number, column: number): SyntaxNode | null {
        return ParserAst.findNodeAtPosition(tree, row, column);
    }

    /**
     * Get all directive nodes from the tree.
     */
    export function getAllDirectives(tree: Tree): SyntaxNode[] {
        return ParserAst.getAllDirectives(tree, getQueryCaptures);
    }

    /**
     * Check if a position is inside a directive parameter.
     */
    export function isInsideDirectiveParameter(tree: Tree, row: number, column: number): boolean {
        return ParserContext.isInsideDirectiveParameter(tree, row, column, findNodeAtPosition, getQueryCaptures);
    }

    /**
     * Check if a position is inside an echo statement.
     */
    export function isInsideEcho(tree: Tree, row: number, column: number): boolean {
        return ParserContext.isInsideEcho(tree, row, column, findNodeAtPosition, getQueryCaptures);
    }

    /**
     * Get the context at a given position for completion.
     */
    export type CompletionContext = ParserContext.CompletionContext;

    export function getCompletionContext(tree: Tree, source: string, row: number, column: number): CompletionContext {
        return ParserContext.getCompletionContext(tree, source, row, column, findNodeAtPosition, getQueryCaptures);
    }

    /**
     * Get diagnostics from the parse tree.
     */
    export type DiagnosticInfo = ParserDiagnostics.DiagnosticInfo;

    export function getDiagnostics(tree: Tree): DiagnosticInfo[] {
        return ParserDiagnostics.getDiagnostics(tree, getQueryCaptures);
    }

    /**
     * Extract the tag name from a start_tag, self_closing_tag, or end_tag node.
     */
    export function getTagName(tagNode: SyntaxNode): string | null {
        return ParserComponents.getTagName(tagNode);
    }

    /**
     * Check whether a tag name looks like a Blade component
     * (x-prefixed or namespace:prefixed like flux:button).
     */
    export function isComponentTagName(name: string): boolean {
        return ParserComponents.isComponentTagName(name);
    }

    /**
     * Find the parent component element that encloses a given position.
     */
    export function findParentComponentFromTree(tree: Tree, row: number, column: number): string | null {
        return ParserComponents.findParentComponentFromTree(tree, row, column, findNodeAtPosition, getQueryCaptures);
    }

    /**
     * Check if a position is inside a component tag (start_tag or self_closing_tag)
     * for prop completion context.
     */
    export type ComponentTagContext = ParserComponents.ComponentTagContext;

    export function getComponentTagContext(tree: Tree, row: number, column: number): ComponentTagContext | null {
        return ParserComponents.getComponentTagContext(tree, row, column, findNodeAtPosition, getQueryCaptures);
    }

    /**
     * Collect all element nodes with component tag names from the tree.
     * Useful for diagnostics (e.g. undefined component detection).
     */
    export type ComponentReference = ParserComponents.ComponentReference;

    export function getAllComponentReferences(tree: Tree): ComponentReference[] {
        return ParserComponents.getAllComponentReferences(tree, getQueryCaptures);
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
