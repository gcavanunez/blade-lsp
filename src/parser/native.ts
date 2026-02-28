/**
 * Native tree-sitter backend (node-gyp).
 *
 * Uses the `tree-sitter` and `tree-sitter-blade` npm packages which
 * require native compilation. Used for local development and testing.
 */

import { ParserTypes } from './types';

type NativePosition = {
    row: number;
    column: number;
};

type NativeSyntaxNode = {
    text: string;
    type: string;
    startPosition: NativePosition;
    endPosition: NativePosition;
    childCount: number;
    child(index: number): NativeSyntaxNode | null;
    parent: NativeSyntaxNode | null;
    hasError: boolean | (() => boolean);
    isMissing: boolean | (() => boolean);
    toString(): string;
};

type NativeLanguageWithQuery = {
    query?: (source: string) => NativeQuery;
};

type NativeQueryCapture = {
    name: string;
    node: NativeSyntaxNode;
    patternIndex?: number;
    pattern?: number;
};

type NativeQuery = {
    captures(node: NativeSyntaxNode): NativeQueryCapture[];
};

type NativeQueryCtor = {
    new (language: unknown, source: string | Buffer): NativeQuery;
};

type NativeParserCtor = {
    new (): {
        parse(source: string): { rootNode: NativeSyntaxNode };
        setLanguage(language: unknown): void;
        getLanguage(): unknown;
    };
    Query?: NativeQueryCtor;
};

const NATIVE_NODE = Symbol('nativeNode');

type WrappedNode = ParserTypes.SyntaxNode & {
    [NATIVE_NODE]: NativeSyntaxNode;
};

export namespace NativeBackend {
    export function create(): ParserTypes.Backend {
        let parser: Awaited<ReturnType<typeof loadParser>>['instance'] | null = null;
        let Query: NativeQueryCtor | null = null;

        async function loadParser() {
            // Dynamic import so this module can be imported without tree-sitter installed.
            const parserModule = await import('tree-sitter');
            const Parser = (parserModule.default ?? parserModule) as unknown as NativeParserCtor;
            const bladeModule = await import('tree-sitter-blade');
            const Blade = bladeModule.default ?? bladeModule;

            const instance = new Parser();
            // tree-sitter-blade >=0.12.0 exports { name, language, nodeTypeInfo }
            // and tree-sitter >=0.25.0 accepts this object directly.
            instance.setLanguage(Blade);
            return { instance, Query: Parser.Query ?? null };
        }

        return {
            async initialize(): Promise<void> {
                const loaded = await loadParser();
                parser = loaded.instance;
                Query = loaded.Query;
            },

            parse(source: string): ParserTypes.Tree {
                if (!parser) {
                    throw new Error('NativeBackend not initialized. Call initialize() first.');
                }

                const tree = parser.parse(source);

                // Native tree-sitter nodes are structurally compatible with ParserTypes,
                // except hasError/isMissing may be properties instead of methods in some
                // versions. Wrap the root to normalize.
                return { rootNode: wrapNode(tree.rootNode) };
            },

            compileQuery(source: string): ParserTypes.CompiledQuery {
                if (!parser) {
                    throw new Error('NativeBackend not initialized. Call initialize() first.');
                }

                const language = parser.getLanguage();
                if (!language) {
                    throw new Error('NativeBackend language not initialized.');
                }

                const languageWithQuery = language as NativeLanguageWithQuery;
                const query =
                    typeof languageWithQuery.query === 'function'
                        ? languageWithQuery.query(source)
                        : Query
                          ? new Query(language, source)
                          : null;

                if (!query) {
                    throw new Error('tree-sitter query support not available in current runtime.');
                }

                return {
                    captures(node: ParserTypes.SyntaxNode): ParserTypes.QueryCapture[] {
                        const nativeNode = unwrapNode(node);

                        return query.captures(nativeNode).map((capture) => ({
                            name: capture.name,
                            node: wrapNode(capture.node),
                            patternIndex: capture.patternIndex ?? capture.pattern ?? 0,
                        }));
                    },
                };
            },
        };
    }

    function unwrapNode(node: ParserTypes.SyntaxNode): NativeSyntaxNode {
        const wrapped = node as Partial<WrappedNode>;
        if (wrapped[NATIVE_NODE]) {
            return wrapped[NATIVE_NODE];
        }

        throw new Error('Expected a native tree-sitter node wrapper.');
    }

    /**
     * Wrap a native SyntaxNode to normalize hasError/isMissing to readonly properties,
     * handling the version compat issue between tree-sitter 0.20.x (methods)
     * and newer versions (property getters).
     */
    function wrapNode(native: NativeSyntaxNode): ParserTypes.SyntaxNode {
        const wrapped: WrappedNode = {
            [NATIVE_NODE]: native,
            get text() {
                return native.text;
            },
            get type() {
                return native.type;
            },
            get startPosition() {
                return native.startPosition;
            },
            get endPosition() {
                return native.endPosition;
            },
            get childCount() {
                return native.childCount;
            },
            child(index: number): ParserTypes.SyntaxNode | null {
                const child = native.child(index);
                return child ? wrapNode(child) : null;
            },
            get parent(): ParserTypes.SyntaxNode | null {
                const p = native.parent;
                return p ? wrapNode(p) : null;
            },
            get hasError(): boolean {
                return typeof native.hasError === 'function' ? native.hasError() : native.hasError;
            },
            get isMissing(): boolean {
                return typeof native.isMissing === 'function' ? native.isMissing() : native.isMissing;
            },
            toString(): string {
                return native.toString();
            },
        };

        return wrapped;
    }
}
