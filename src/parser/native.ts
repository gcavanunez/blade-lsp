/**
 * Native tree-sitter backend (node-gyp).
 *
 * Uses the `tree-sitter` and `tree-sitter-blade` npm packages which
 * require native compilation. Used for local development and testing.
 */

import { ParserTypes } from './types';

export namespace NativeBackend {
    export function create(): ParserTypes.Backend {
        let parser: ReturnType<typeof loadParser> | null = null;

        function loadParser() {
            // Dynamic require so this module can be imported without tree-sitter installed.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Parser = require('tree-sitter') as typeof import('tree-sitter');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Blade = require('tree-sitter-blade');

            const instance = new Parser();
            instance.setLanguage(Blade);
            return instance;
        }

        return {
            async initialize(): Promise<void> {
                parser = loadParser();
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
        };
    }

    /**
     * Wrap a native SyntaxNode to normalize hasError/isMissing to readonly properties,
     * handling the version compat issue between tree-sitter 0.20.x (methods)
     * and newer versions (property getters).
     */
    function wrapNode(native: any): ParserTypes.SyntaxNode {
        return {
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
    }
}
