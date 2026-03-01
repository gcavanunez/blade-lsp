import { ParserTypes } from './types';
import { ParserQueryBank } from './query-bank';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;
type QueryCapture = ParserTypes.QueryCapture;

type FindNodeAtPosition = (tree: Tree, row: number, column: number) => SyntaxNode | null;
type QueryCaptures = (tree: Tree, querySource: string) => QueryCapture[];

function isPositionWithinNode(node: SyntaxNode, row: number, column: number): boolean {
    const start = node.startPosition;
    const end = node.endPosition;

    if (row < start.row || row > end.row) return false;
    if (row === start.row && column < start.column) return false;
    if (row === end.row && column > end.column) return false;

    return true;
}

function isStrictlyNarrowerRange(a: SyntaxNode, b: SyntaxNode): boolean {
    if (a.startPosition.row !== b.startPosition.row) {
        return a.startPosition.row > b.startPosition.row;
    }

    if (a.startPosition.column !== b.startPosition.column) {
        return a.startPosition.column > b.startPosition.column;
    }

    if (a.endPosition.row !== b.endPosition.row) {
        return a.endPosition.row < b.endPosition.row;
    }

    return a.endPosition.column < b.endPosition.column;
}

function isValidComponentName(tagName: string): boolean {
    return (
        (tagName.startsWith('x-') || /^[\w]+:[\w.-]+$/.test(tagName)) &&
        tagName !== 'x-slot' &&
        !tagName.startsWith('x-slot:')
    );
}

export namespace ParserComponents {
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
     */
    export function findParentComponentFromTree(
        tree: Tree,
        row: number,
        column: number,
        findNodeAtPosition: FindNodeAtPosition,
        queryCaptures: QueryCaptures,
    ): string | null {
        try {
            const fromQuery = findParentComponentFromQuery(tree, row, column, queryCaptures);
            if (fromQuery) return fromQuery;
        } catch {
            // Fall back to traversal.
        }

        const node = findNodeAtPosition(tree, row, column);
        if (!node) return null;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'element') {
                const startTag = current.child(0);
                if (startTag && (startTag.type === 'start_tag' || startTag.type === 'self_closing_tag')) {
                    const tagName = getTagName(startTag);
                    if (tagName && isValidComponentName(tagName)) {
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
     */
    export interface ComponentTagContext {
        componentName: string;
        existingProps: string[];
    }

    export function getComponentTagContext(
        tree: Tree,
        row: number,
        column: number,
        findNodeAtPosition: FindNodeAtPosition,
        queryCaptures: QueryCaptures,
    ): ComponentTagContext | null {
        try {
            const fromQuery = getComponentTagContextFromQuery(tree, row, column, queryCaptures);
            if (fromQuery) return fromQuery;
        } catch {
            // Fall back to traversal.
        }

        const node = findNodeAtPosition(tree, row, column);
        if (!node) return null;

        let current: SyntaxNode | null = node;
        while (current) {
            if (current.type === 'start_tag' || current.type === 'self_closing_tag') {
                const tagName = getTagName(current);
                if (tagName && isValidComponentName(tagName)) {
                    const existingProps = extractPropsFromTag(current);
                    return { componentName: tagName, existingProps };
                }
                return null;
            }
            current = current.parent;
        }
        return null;
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

    export function getAllComponentReferences(tree: Tree, queryCaptures: QueryCaptures): ComponentReference[] {
        try {
            return getAllComponentReferencesFromQuery(tree, queryCaptures);
        } catch {
            // Fall back to traversal in case the parser runtime does not support queries.
            const refs: ComponentReference[] = [];
            collectComponentRefs(tree.rootNode, refs);
            return refs;
        }
    }

    function getAllComponentReferencesFromQuery(tree: Tree, queryCaptures: QueryCaptures): ComponentReference[] {
        const refs: ComponentReference[] = [];

        for (const capture of queryCaptures(tree, ParserQueryBank.componentTagNames)) {
            if (capture.name !== 'tag_name') continue;

            const tagName = capture.node.text;
            if (!isComponentTagName(tagName)) continue;

            refs.push({
                tagName,
                startPosition: capture.node.startPosition,
                endPosition: capture.node.endPosition,
            });
        }

        return refs;
    }

    function findParentComponentFromQuery(
        tree: Tree,
        row: number,
        column: number,
        queryCaptures: QueryCaptures,
    ): string | null {
        let best: { node: SyntaxNode; tagName: string } | null = null;

        for (const capture of queryCaptures(tree, ParserQueryBank.componentTagNames)) {
            if (capture.name !== 'tag_name') continue;

            const tagName = capture.node.text;
            if (!isValidComponentName(tagName)) continue;

            const tagNode = capture.node.parent;
            if (!tagNode) continue;

            const scopeNode = tagNode.parent?.type === 'element' ? tagNode.parent : tagNode;
            if (!isPositionWithinNode(scopeNode, row, column)) continue;

            if (!best || isStrictlyNarrowerRange(scopeNode, best.node)) {
                best = { node: scopeNode, tagName };
            }
        }

        return best?.tagName ?? null;
    }

    function getComponentTagContextFromQuery(
        tree: Tree,
        row: number,
        column: number,
        queryCaptures: QueryCaptures,
    ): ComponentTagContext | null {
        let bestTagNode: SyntaxNode | null = null;
        let bestTagName: string | null = null;

        for (const capture of queryCaptures(tree, ParserQueryBank.componentTagNames)) {
            if (capture.name !== 'tag_name') continue;

            const tagName = capture.node.text;
            if (!isValidComponentName(tagName)) continue;

            const tagNode = capture.node.parent;
            if (!tagNode) continue;
            if (!isPositionWithinNode(tagNode, row, column)) continue;

            if (!bestTagNode || isStrictlyNarrowerRange(tagNode, bestTagNode)) {
                bestTagNode = tagNode;
                bestTagName = tagName;
            }
        }

        if (!bestTagNode || !bestTagName) return null;

        return {
            componentName: bestTagName,
            existingProps: extractPropsFromTag(bestTagNode),
        };
    }

    function extractPropsFromTag(tagNode: SyntaxNode): string[] {
        const props: string[] = [];
        for (let i = 0; i < tagNode.childCount; i++) {
            const child = tagNode.child(i);
            if (child?.type === 'attribute') {
                for (let j = 0; j < child.childCount; j++) {
                    const attrChild = child.child(j);
                    if (attrChild?.type === 'attribute_name') {
                        const name = attrChild.text.replace(/^:/, '');
                        props.push(name);
                        break;
                    }
                }
            }
        }
        return props;
    }

    function getTagNameNode(tagNode: SyntaxNode): SyntaxNode | null {
        for (let i = 0; i < tagNode.childCount; i++) {
            const child = tagNode.child(i);
            if (child?.type === 'tag_name') return child;
        }

        return null;
    }

    function collectComponentRefs(node: SyntaxNode, refs: ComponentReference[]): void {
        if (node.type === 'start_tag' || node.type === 'self_closing_tag') {
            const tagName = getTagName(node);
            const tagNameNode = getTagNameNode(node);
            if (tagName && isComponentTagName(tagName)) {
                refs.push({
                    tagName,
                    startPosition: tagNameNode?.startPosition ?? node.startPosition,
                    endPosition: tagNameNode?.endPosition ?? node.endPosition,
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
}
