import { ParserTypes } from './types';

type SyntaxNode = ParserTypes.SyntaxNode;
type Tree = ParserTypes.Tree;

type FindNodeAtPosition = (tree: Tree, row: number, column: number) => SyntaxNode | null;

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
    ): string | null {
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
    ): ComponentTagContext | null {
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

    export function getAllComponentReferences(tree: Tree): ComponentReference[] {
        const refs: ComponentReference[] = [];
        collectComponentRefs(tree.rootNode, refs);
        return refs;
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
}
