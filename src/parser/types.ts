/**
 * Shared types for tree-sitter parser backends.
 *
 * Both native (node-gyp) and WASM (web-tree-sitter) backends implement
 * the Backend interface. The SyntaxNode and Tree interfaces cover the
 * exact API surface used by this project -- nothing more.
 */

export namespace ParserTypes {
    interface Position {
        row: number;
        column: number;
    }

    export interface SyntaxNode {
        readonly text: string;
        readonly type: string;
        readonly startPosition: Position;
        readonly endPosition: Position;
        readonly childCount: number;
        child(index: number): SyntaxNode | null;
        readonly parent: SyntaxNode | null;
        // Getters in web-tree-sitter, methods in native 0.20.x, getters in newer native.
        // Each backend normalizes to a readonly property.
        readonly hasError: boolean;
        readonly isMissing: boolean;
        toString(): string;
    }

    export interface Tree {
        rootNode: SyntaxNode;
    }

    export interface Backend {
        initialize(): Promise<void>;
        parse(source: string): Tree;
    }
}
