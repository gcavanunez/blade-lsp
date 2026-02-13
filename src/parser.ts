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
import { Container } from './runtime/container';
import { BladeDirectives } from './directives';

export namespace BladeParser {
    export type SyntaxNode = ParserTypes.SyntaxNode;
    export type Tree = ParserTypes.Tree;

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
     *
     * In tree-sitter-blade >=0.12, directive parameters are `parameter` nodes
     * that sit between `(` and `)` siblings inside directive containers
     * (conditional, loop, section, etc.).
     */
    export function isInsideDirectiveParameter(tree: Tree, row: number, column: number): boolean {
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
     *
     * In tree-sitter-blade >=0.12, echo statements are parsed as:
     *   php_statement -> {{ / php_only / }}
     *   php_statement -> {!! / php_only / !!}
     * So we walk up looking for php_only or php_statement with echo delimiters.
     */
    export function isInsideEcho(tree: Tree, row: number, column: number): boolean {
        const node = findNodeAtPosition(tree, row, column);
        if (!node) return false;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'php_only') {
                return true;
            }
            // php_statement wraps both echo ({{ }}) and @php blocks.
            // Check if the first child is an echo delimiter to distinguish.
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

    export function getCompletionContext(tree: Tree, source: string, row: number, column: number): CompletionContext {
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

        if (node && isInsideEcho(tree, row, column)) {
            return {
                type: 'echo',
                prefix: '',
                node,
            };
        }

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

    /**
     * tree-sitter-blade currently treats `@` inside quoted HTML attribute values
     * as a directive start, which produces a false-positive ERROR node for common
     * strings like email placeholders (`name@example.com`).
     */
    function subtreeContainsType(node: SyntaxNode, type: string): boolean {
        if (node.type === type) return true;

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && subtreeContainsType(child, type)) {
                return true;
            }
        }

        return false;
    }

    function hasAncestorType(node: SyntaxNode, type: string): boolean {
        let current = node.parent;
        while (current) {
            if (current.type === type) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    function findAncestorTagNode(node: SyntaxNode): SyntaxNode | null {
        let current: SyntaxNode | null = node.parent;
        while (current) {
            if (current.type === 'start_tag' || current.type === 'self_closing_tag') {
                return current;
            }
            current = current.parent;
        }
        return null;
    }

    function collectTagAttributeNames(tagNode: SyntaxNode): string[] {
        const names: string[] = [];

        for (let i = 0; i < tagNode.childCount; i++) {
            const child = tagNode.child(i);
            if (!child) continue;

            if (child.type === 'attribute_name') {
                names.push(child.text);
                continue;
            }

            if (child.type !== 'attribute') continue;

            for (let j = 0; j < child.childCount; j++) {
                const attrChild = child.child(j);
                if (attrChild?.type === 'attribute_name') {
                    names.push(attrChild.text);
                    break;
                }
            }
        }

        return names;
    }

    function hasInlineBladeConditionalAttributes(tagNode: SyntaxNode): boolean {
        const names = collectTagAttributeNames(tagNode);
        const hasBladeOpener = names.some((name) => name.startsWith('@') && !name.startsWith('@end'));
        if (!hasBladeOpener) return false;

        const hasBladeCloser = names.some((name) => name.startsWith('@end'));
        if (hasBladeCloser) return true;

        const element = tagNode.parent;
        if (!element || element.type !== 'element') return false;

        for (let i = 0; i < element.childCount; i++) {
            const child = element.child(i);
            if (!child || child === tagNode) continue;

            if (/@end[A-Za-z_]\w*/.test(child.text)) {
                return true;
            }
        }

        return false;
    }

    const TAILWIND_CONTAINER_QUERY_VARIANTS = new Set([
        '@3xs',
        '@2xs',
        '@xs',
        '@sm',
        '@md',
        '@lg',
        '@xl',
        '@2xl',
        '@3xl',
        '@4xl',
        '@5xl',
        '@6xl',
        '@7xl',
    ]);

    function isTailwindContainerQueryAttributeName(name: string): boolean {
        return /^@(3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl):/.test(name);
    }

    function findFirstDescendant(node: SyntaxNode, type: string): SyntaxNode | null {
        if (node.type === type) return node;

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;

            const found = findFirstDescendant(child, type);
            if (found) return found;
        }

        return null;
    }

    function isTailwindContainerQueryAttributeError(node: SyntaxNode): boolean {
        if (node.type !== 'ERROR') return false;

        const tagNode = findAncestorTagNode(node);
        if (!tagNode) return false;

        const attributeNames = collectTagAttributeNames(tagNode);
        const hasClassAttribute = attributeNames.includes('class');
        const hasTailwindContainerQueryAttribute = attributeNames.some(isTailwindContainerQueryAttributeName);

        if (node.text === '"' && hasTailwindContainerQueryAttribute) {
            return true;
        }

        const directiveStart = findFirstDescendant(node, 'directive_start');
        if (!directiveStart) return false;
        if (!TAILWIND_CONTAINER_QUERY_VARIANTS.has(directiveStart.text)) return false;

        return hasClassAttribute;
    }

    function isInlineBladeConditionalTagError(node: SyntaxNode): boolean {
        if (node.type !== 'ERROR') return false;
        if (!/^[\s'"()]+$/.test(node.text)) return false;

        const tagNode = findAncestorTagNode(node);
        if (!tagNode) return false;

        return hasInlineBladeConditionalAttributes(tagNode);
    }

    function isAtSignInQuotedAttributeError(node: SyntaxNode): boolean {
        if (node.type !== 'ERROR') return false;

        const hasDirectiveStart = subtreeContainsType(node, 'directive_start');
        if (!hasDirectiveStart) return false;

        if (hasAncestorType(node, 'quoted_attribute_value')) {
            return true;
        }

        const hasAttributeValue = subtreeContainsType(node, 'attribute_value');
        if (!hasAttributeValue) return false;

        const parent = node.parent;
        if (parent && (parent.type === 'start_tag' || parent.type === 'self_closing_tag')) {
            return true;
        }

        const hasTagName = subtreeContainsType(node, 'tag_name');
        const hasAttributeShape = subtreeContainsType(node, 'attribute') || subtreeContainsType(node, 'attribute_name');

        return hasTagName && hasAttributeShape;
    }

    function hasAtSignInQuotedAttributeErrorAncestor(node: SyntaxNode): boolean {
        let current = node.parent;
        while (current) {
            if (isAtSignInQuotedAttributeError(current)) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    function isUnknownDirectiveTokenError(node: SyntaxNode): boolean {
        if (node.type !== 'ERROR') return false;
        if (node.childCount !== 1) return false;

        const child = node.child(0);
        if (child?.type !== 'directive_start') return false;

        const name = child.text;
        if (!/^@(?:end)?[A-Za-z_]\w*$/.test(name)) return false;

        return !BladeDirectives.map.has(name);
    }

    function collectNodeDiagnostic(node: SyntaxNode, diagnostics: DiagnosticInfo[]): void {
        if (!node.hasError) return;

        if (node.isMissing) {
            diagnostics.push({
                message: `Missing ${node.type}`,
                startPosition: node.startPosition,
                endPosition: node.endPosition,
                severity: 'error',
            });
            return;
        }

        if (node.type !== 'ERROR') return;
        if (isAtSignInQuotedAttributeError(node)) return;
        if (hasAtSignInQuotedAttributeErrorAncestor(node)) return;
        if (isTailwindContainerQueryAttributeError(node)) return;
        if (isInlineBladeConditionalTagError(node)) return;
        if (isUnknownDirectiveTokenError(node)) return;

        diagnostics.push({
            message: 'Syntax error',
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            severity: 'error',
        });
    }

    function checkForErrors(node: SyntaxNode, diagnostics: DiagnosticInfo[]): void {
        collectNodeDiagnostic(node, diagnostics);

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                checkForErrors(child, diagnostics);
            }
        }
    }

    // ─── HTML / Component tag helpers (tree-sitter-blade >=0.12) ────────────

    /**
     * Extract the tag name from a start_tag, self_closing_tag, or end_tag node.
     */
    export function getTagName(tagNode: SyntaxNode): string | null {
        for (let i = 0; i < tagNode.childCount; i++) {
            const child = tagNode.child(i);
            if (child?.type === 'tag_name') {
                return child.text;
            }
        }
        return null;
    }

    /**
     * Check whether a tag name looks like a Blade component
     * (x-prefixed or namespace:prefixed like flux:button).
     */
    export function isComponentTagName(name: string): boolean {
        return name.startsWith('x-') || /^[\w]+:[\w.-]+$/.test(name);
    }

    /**
     * Find the parent component element that encloses a given position.
     *
     * Walks up the AST from the node at (row, column) looking for an
     * `element` whose `start_tag` has a component tag name (x-* or ns:*),
     * skipping x-slot elements.
     */
    export function findParentComponentFromTree(tree: Tree, row: number, column: number): string | null {
        const node = findNodeAtPosition(tree, row, column);
        if (!node) return null;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'element') {
                const startTag = current.child(0);
                if (startTag && (startTag.type === 'start_tag' || startTag.type === 'self_closing_tag')) {
                    const tagName = getTagName(startTag);
                    if (
                        tagName &&
                        isComponentTagName(tagName) &&
                        tagName !== 'x-slot' &&
                        !tagName.startsWith('x-slot:')
                    ) {
                        return tagName;
                    }
                }
            }
            current = current.parent;
        }

        return null;
    }

    /**
     * Check if a position is inside a component tag (start_tag or self_closing_tag)
     * for prop completion context.
     *
     * Returns the component name and existing prop names, or null if not in a component tag.
     */
    export interface ComponentTagContext {
        componentName: string;
        existingProps: string[];
    }

    export function getComponentTagContext(tree: Tree, row: number, column: number): ComponentTagContext | null {
        const node = findNodeAtPosition(tree, row, column);
        if (!node) return null;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'start_tag' || current.type === 'self_closing_tag') {
                const tagName = getTagName(current);
                if (tagName && isComponentTagName(tagName) && tagName !== 'x-slot') {
                    const existingProps = extractPropsFromTag(current);
                    return { componentName: tagName, existingProps };
                }
                return null; // In a tag but not a component tag
            }
            current = current.parent;
        }
        return null;
    }

    /**
     * Extract attribute names from a start_tag or self_closing_tag node.
     */
    function extractPropsFromTag(tagNode: SyntaxNode): string[] {
        const props: string[] = [];
        for (let i = 0; i < tagNode.childCount; i++) {
            const child = tagNode.child(i);
            if (child?.type === 'attribute') {
                for (let j = 0; j < child.childCount; j++) {
                    const attrChild = child.child(j);
                    if (attrChild?.type === 'attribute_name') {
                        // Strip leading : for dynamic props
                        const name = attrChild.text.replace(/^:/, '');
                        props.push(name);
                        break;
                    }
                }
            }
        }
        return props;
    }

    /**
     * Collect all element nodes with component tag names from the tree.
     * Useful for diagnostics (e.g. undefined component detection).
     */
    export interface ComponentReference {
        tagName: string;
        startPosition: { row: number; column: number };
        endPosition: { row: number; column: number };
    }

    export function getAllComponentReferences(tree: Tree): ComponentReference[] {
        const refs: ComponentReference[] = [];
        collectComponentRefs(tree.rootNode, refs);
        return refs;
    }

    function collectComponentRefs(node: SyntaxNode, refs: ComponentReference[]): void {
        if (node.type === 'start_tag' || node.type === 'self_closing_tag') {
            const tagName = getTagName(node);
            if (tagName && isComponentTagName(tagName)) {
                refs.push({
                    tagName,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                });
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                collectComponentRefs(child, refs);
            }
        }
    }

    // ─── Debug helpers ───────────────────────────────────────────────────────

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
