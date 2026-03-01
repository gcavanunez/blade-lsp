/**
 * Shared types for tree-sitter parser operations.
 *
 * The SyntaxNode and Tree interfaces cover the exact API surface used by
 * this project -- nothing more.
 */

export namespace ParserTypes {
    export interface Position {
        row: number;
        column: number;
    }

    export interface TreeChangeRange {
        startPosition: Position;
        endPosition: Position;
    }

    export interface TreeEdit {
        startIndex: number;
        oldEndIndex: number;
        newEndIndex: number;
        startPosition: Position;
        oldEndPosition: Position;
        newEndPosition: Position;
    }

    export interface SyntaxNode {
        readonly text: string;
        readonly type: string;
        readonly startPosition: Position;
        readonly endPosition: Position;
        readonly childCount: number;
        child(index: number): SyntaxNode | null;
        readonly parent: SyntaxNode | null;
        // web-tree-sitter exposes these as readonly properties.
        readonly hasError: boolean;
        readonly isMissing: boolean;
        toString(): string;
    }

    export interface Tree {
        rootNode: SyntaxNode;
        edit?(edit: TreeEdit): void;
        getChangedRanges?(other: Tree): TreeChangeRange[];
    }

    export interface QueryCapture {
        name: string;
        node: SyntaxNode;
        patternIndex: number;
    }

    export interface CompiledQuery {
        captures(node: SyntaxNode): QueryCapture[];
    }

    export interface Runtime {
        initialize(): Promise<void>;
        parse(source: string, previousTree?: Tree): Tree;
        compileQuery(source: string): CompiledQuery;
    }
}
