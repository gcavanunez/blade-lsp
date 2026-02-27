import { BladeDirectives } from '../directives';
import { ParserTypes } from './types';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;

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
}
