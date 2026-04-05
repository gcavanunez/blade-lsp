/**
 * Tree-sitter based Blade parser.
 *
 * Public API for all tree-sitter operations.
 *
 * Uses the WASM parser runtime (web-tree-sitter) for a portable setup with no
 * native compilation requirements.
 */

import { MutableRef } from 'effect';
import z from 'zod';
import { ParserTypes } from './parser/types';
import { WasmBackend } from './parser/wasm';
import { ParserContext } from './parser/context';
import { ParserComponents } from './parser/components';
import { ParserDiagnostics } from './parser/diagnostics';
import { ParserAst } from './parser/ast';
import { Container } from './runtime/container';
import { NamedError } from './utils/error';

export namespace BladeParser {
    export const NotInitializedError = NamedError.create(
        'BladeParserNotInitializedError',
        z.object({ message: z.string() }),
    );

    export type SyntaxNode = ParserTypes.SyntaxNode;
    export type Tree = ParserTypes.Tree;
    export type QueryCapture = ParserTypes.QueryCapture;

    const queryCache = new Map<string, ParserTypes.CompiledQuery>();
    let queryCaptureCache = new WeakMap<Tree, Map<string, QueryCapture[]>>();

    /**
     * Initialize the parser.
     *
     * Stores the parser runtime in the service container's `parserRuntime` MutableRef.
     */
    export async function initialize(): Promise<void> {
        const runtime = WasmBackend.create();
        await runtime.initialize();
        MutableRef.set(Container.get().parserRuntime, runtime);
        queryCache.clear();
        queryCaptureCache = new WeakMap<Tree, Map<string, QueryCapture[]>>();
    }

    /**
     * Parse a Blade template and return the syntax tree.
     */
    export function parse(source: string, previousTree?: Tree): Tree {
        const runtime = MutableRef.get(Container.get().parserRuntime);
        if (!runtime) {
            throw new NotInitializedError({ message: 'BladeParser not initialized. Call initialize() first.' });
        }
        return runtime.parse(source, previousTree);
    }

    function getQueryCaptures(tree: Tree, querySource: string, node: SyntaxNode = tree.rootNode): QueryCapture[] {
        const runtime = MutableRef.get(Container.get().parserRuntime);
        if (!runtime) {
            throw new NotInitializedError({ message: 'BladeParser not initialized. Call initialize() first.' });
        }

        const compiled = queryCache.get(querySource) ?? runtime.compileQuery(querySource);
        queryCache.set(querySource, compiled);

        if (node !== tree.rootNode) {
            return compiled.captures(node);
        }

        const treeCache = queryCaptureCache.get(tree) ?? new Map<string, QueryCapture[]>();
        queryCaptureCache.set(tree, treeCache);

        const cached = treeCache.get(querySource);
        if (cached) {
            return cached;
        }

        const captures = compiled.captures(node);
        treeCache.set(querySource, captures);
        return captures;
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
}
