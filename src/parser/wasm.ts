/**
 * WASM tree-sitter backend (web-tree-sitter).
 *
 * Uses the `web-tree-sitter` npm package with a precompiled `.wasm` grammar.
 * No native compilation required -- this is the default for npm distribution.
 */

import * as path from 'path';
import { ParserTypes } from './types';

export namespace WasmBackend {
    export function create(): ParserTypes.Backend {
        let parser: any | null = null;

        return {
            async initialize(): Promise<void> {
                // Dynamic import so this module can be loaded without web-tree-sitter installed.
                // web-tree-sitter exports differ by context:
                //   - CJS compiled:  module.exports = Parser (constructor with .init, .Language)
                //   - Named exports: { Parser, Language, ... }
                const mod = require('web-tree-sitter');
                const Parser = typeof mod.init === 'function' ? mod : (mod.Parser ?? mod.default);
                const Language = Parser.Language ?? mod.Language;
                await Parser.init();

                parser = new Parser();

                // Resolve the .wasm grammar file.
                // In dist/: dist/parser/wasm.js -> dist/tree-sitter-blade.wasm (one level up)
                // In src/ (test): src/parser/wasm.ts -> tree-sitter-blade.wasm (two levels up)
                const fs = require('fs');
                const candidates = [
                    path.resolve(__dirname, '..', 'tree-sitter-blade.wasm'),
                    path.resolve(__dirname, '..', '..', 'tree-sitter-blade.wasm'),
                ];
                const wasmPath = candidates.find((p) => fs.existsSync(p));
                if (!wasmPath) {
                    throw new Error(`tree-sitter-blade.wasm not found. Searched: ${candidates.join(', ')}`);
                }
                const language = await Language.load(wasmPath);
                parser.setLanguage(language);
            },

            parse(source: string): ParserTypes.Tree {
                if (!parser) {
                    throw new Error('WasmBackend not initialized. Call initialize() first.');
                }

                const tree = parser.parse(source);

                // web-tree-sitter nodes are structurally compatible with ParserTypes.
                // hasError and isMissing are getter properties in web-tree-sitter,
                // which matches our readonly property interface.
                return tree as ParserTypes.Tree;
            },
        };
    }
}
