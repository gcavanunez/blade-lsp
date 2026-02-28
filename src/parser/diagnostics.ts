import { BladeDirectives } from '../directives';
import { ParserTypes } from './types';
import { ParserQueryBank } from './query-bank';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;
type QueryCapture = ParserTypes.QueryCapture;

type QueryCaptures = (tree: Tree, querySource: string, node?: SyntaxNode) => QueryCapture[];

interface ErrorNodeContext {
    ancestors: SyntaxNode[];
    nearestTagNode: SyntaxNode | null;
    nearestAttributeNode: SyntaxNode | null;
    hasQuotedAttributeValueAncestor: boolean;
}

export namespace ParserDiagnostics {
    /**
     * Diagnostic information.
     */
    export interface DiagnosticInfo {
        message: string;
        startPosition: { row: number; column: number };
        endPosition: { row: number; column: number };
        severity: 'error' | 'warning' | 'info';
    }

    /**
     * Get diagnostics from the parse tree.
     */
    export function getDiagnostics(tree: Tree, queryCaptures?: QueryCaptures): DiagnosticInfo[] {
        const diagnostics: DiagnosticInfo[] = [];

        if (!tree.rootNode.hasError) {
            return diagnostics;
        }

        const fallbackErrorNodes: SyntaxNode[] = [];
        collectMissingNodeDiagnostics(tree.rootNode, diagnostics, new Set<string>(), fallbackErrorNodes);

        const errorNodes = collectErrorNodesFromQuery(tree, queryCaptures) ?? fallbackErrorNodes;

        for (const node of errorNodes) {
            collectErrorNodeDiagnostic(tree, node, diagnostics, queryCaptures);
        }

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

    function subtreeContainsTypeWithQuery(
        tree: Tree,
        node: SyntaxNode,
        type: string,
        queryCaptures?: QueryCaptures,
    ): boolean {
        const query = ParserQueryBank.getByNodeType(type);

        if (query && queryCaptures) {
            try {
                return queryCaptures(tree, query, node).length > 0;
            } catch {
                // Fall back to recursive traversal.
            }
        }

        return subtreeContainsType(node, type);
    }

    function buildErrorNodeContext(node: SyntaxNode): ErrorNodeContext {
        const ancestors: SyntaxNode[] = [];
        let nearestTagNode: SyntaxNode | null = null;
        let nearestAttributeNode: SyntaxNode | null = null;
        let hasQuotedAttributeValueAncestor = false;

        let current = node.parent;
        while (current) {
            ancestors.push(current);

            if (!hasQuotedAttributeValueAncestor && current.type === 'quoted_attribute_value') {
                hasQuotedAttributeValueAncestor = true;
            }

            if (!nearestTagNode && (current.type === 'start_tag' || current.type === 'self_closing_tag')) {
                nearestTagNode = current;
            }

            if (!nearestAttributeNode && current.type === 'attribute') {
                nearestAttributeNode = current;
            }

            current = current.parent;
        }

        return {
            ancestors,
            nearestTagNode,
            nearestAttributeNode,
            hasQuotedAttributeValueAncestor,
        };
    }

    function getAttributeNameFromNode(attributeNode: SyntaxNode): string | null {
        for (let i = 0; i < attributeNode.childCount; i++) {
            const child = attributeNode.child(i);
            if (child?.type === 'attribute_name') {
                return child.text;
            }
        }

        return null;
    }

    function collectTagAttributeNames(tree: Tree, tagNode: SyntaxNode, queryCaptures?: QueryCaptures): string[] {
        if (queryCaptures) {
            try {
                const names = queryCaptures(tree, ParserQueryBank.attributeNames, tagNode).map(
                    (capture) => capture.node.text,
                );
                if (names.length > 0) {
                    return names;
                }
            } catch {
                // Fall back to structural traversal.
            }
        }

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

    function hasInlineBladeConditionalAttributes(
        tree: Tree,
        tagNode: SyntaxNode,
        queryCaptures?: QueryCaptures,
    ): boolean {
        const names = collectTagAttributeNames(tree, tagNode, queryCaptures);
        const hasBladeOpener = names.some((name) => name.startsWith('@') && !name.startsWith('@end'));
        if (!hasBladeOpener) return false;

        const hasBladeCloser = names.some((name) => name.startsWith('@end'));
        if (hasBladeCloser) return true;

        const element = tagNode.parent;
        if (!element || element.type !== 'element') return false;

        if (queryCaptures) {
            try {
                const hasDirectiveEnd = queryCaptures(tree, ParserQueryBank.directiveEnd, element).some((capture) =>
                    capture.node.text.startsWith('@end'),
                );
                if (hasDirectiveEnd) {
                    return true;
                }
            } catch {
                // Fall back to text scan.
            }
        }

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

    function findFirstDescendantWithQuery(
        tree: Tree,
        node: SyntaxNode,
        type: string,
        queryCaptures?: QueryCaptures,
    ): SyntaxNode | null {
        const query = ParserQueryBank.getByNodeType(type);

        if (query && queryCaptures) {
            try {
                const capture = queryCaptures(tree, query, node)[0];
                if (capture) return capture.node;
            } catch {
                // Fall back to recursive traversal.
            }
        }

        return findFirstDescendant(node, type);
    }

    function isTailwindContainerQueryAttributeError(
        tree: Tree,
        node: SyntaxNode,
        context: ErrorNodeContext,
        queryCaptures?: QueryCaptures,
    ): boolean {
        if (node.type !== 'ERROR') return false;

        const tagNode = context.nearestTagNode;
        if (!tagNode) return false;

        const attributeNames = collectTagAttributeNames(tree, tagNode, queryCaptures);
        const hasClassAttribute = attributeNames.includes('class');
        const hasTailwindContainerQueryAttribute = attributeNames.some(isTailwindContainerQueryAttributeName);

        if (node.text === '"' && hasTailwindContainerQueryAttribute) {
            return true;
        }

        const directiveStart = findFirstDescendantWithQuery(tree, node, 'directive_start', queryCaptures);
        if (!directiveStart) return false;
        if (!TAILWIND_CONTAINER_QUERY_VARIANTS.has(directiveStart.text)) return false;

        return hasClassAttribute;
    }

    function isInlineBladeConditionalTagError(
        tree: Tree,
        node: SyntaxNode,
        context: ErrorNodeContext,
        queryCaptures?: QueryCaptures,
    ): boolean {
        if (node.type !== 'ERROR') return false;

        const tagNode = context.nearestTagNode;
        if (!tagNode) return false;
        if (!hasInlineBladeConditionalAttributes(tree, tagNode, queryCaptures)) return false;

        const attributeNode = context.nearestAttributeNode;
        if (attributeNode) {
            const attributeName = getAttributeNameFromNode(attributeNode);
            if (attributeName?.startsWith('@') && !attributeName.startsWith('@end')) {
                return true;
            }
        }

        return /^[\s'"()=<>!&|?:+-]+$/.test(node.text);
    }

    function isAtSignInQuotedAttributeError(
        tree: Tree,
        node: SyntaxNode,
        context: ErrorNodeContext,
        queryCaptures?: QueryCaptures,
    ): boolean {
        if (node.type !== 'ERROR') return false;

        const hasDirectiveStart = subtreeContainsTypeWithQuery(tree, node, 'directive_start', queryCaptures);
        if (!hasDirectiveStart) return false;

        if (context.hasQuotedAttributeValueAncestor) {
            return true;
        }

        const hasAttributeValue = subtreeContainsTypeWithQuery(tree, node, 'attribute_value', queryCaptures);
        if (!hasAttributeValue) return false;

        const parent = node.parent;
        if (parent && (parent.type === 'start_tag' || parent.type === 'self_closing_tag')) {
            return true;
        }

        const hasTagName = subtreeContainsTypeWithQuery(tree, node, 'tag_name', queryCaptures);
        const hasAttributeShape =
            subtreeContainsTypeWithQuery(tree, node, 'attribute', queryCaptures) ||
            subtreeContainsTypeWithQuery(tree, node, 'attribute_name', queryCaptures);

        return hasTagName && hasAttributeShape;
    }

    function hasAtSignInQuotedAttributeErrorAncestor(
        tree: Tree,
        context: ErrorNodeContext,
        queryCaptures?: QueryCaptures,
    ): boolean {
        for (const ancestor of context.ancestors) {
            if (ancestor.type !== 'ERROR') continue;

            if (isAtSignInQuotedAttributeError(tree, ancestor, buildErrorNodeContext(ancestor), queryCaptures)) {
                return true;
            }
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

    function collectErrorNodeDiagnostic(
        tree: Tree,
        node: SyntaxNode,
        diagnostics: DiagnosticInfo[],
        queryCaptures?: QueryCaptures,
    ): void {
        const context = buildErrorNodeContext(node);

        if (!node.hasError || node.isMissing) return;
        if (node.type !== 'ERROR') return;
        if (isAtSignInQuotedAttributeError(tree, node, context, queryCaptures)) return;
        if (hasAtSignInQuotedAttributeErrorAncestor(tree, context, queryCaptures)) return;
        if (isTailwindContainerQueryAttributeError(tree, node, context, queryCaptures)) return;
        if (isInlineBladeConditionalTagError(tree, node, context, queryCaptures)) return;
        if (isUnknownDirectiveTokenError(node)) return;

        diagnostics.push({
            message: 'Syntax error',
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            severity: 'error',
        });
    }

    function collectMissingNodeDiagnostics(
        node: SyntaxNode,
        diagnostics: DiagnosticInfo[],
        seen: Set<string>,
        errorNodes: SyntaxNode[],
    ): void {
        if (!node.hasError) return;

        if (node.type === 'ERROR' && !node.isMissing) {
            errorNodes.push(node);
        }

        if (node.isMissing) {
            const key = `${node.type}:${node.startPosition.row}:${node.startPosition.column}:${node.endPosition.row}:${node.endPosition.column}`;
            if (!seen.has(key)) {
                seen.add(key);
                diagnostics.push({
                    message: `Missing ${node.type}`,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                    severity: 'error',
                });
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child?.hasError) {
                collectMissingNodeDiagnostics(child, diagnostics, seen, errorNodes);
            }
        }
    }

    function collectErrorNodesFromQuery(tree: Tree, queryCaptures?: QueryCaptures): SyntaxNode[] | null {
        if (!queryCaptures) return null;

        try {
            return queryCaptures(tree, ParserQueryBank.errorNodes)
                .map((capture) => capture.node)
                .filter((node) => node.type === 'ERROR');
        } catch {
            return null;
        }
    }
}
