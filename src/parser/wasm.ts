/**
 * WASM tree-sitter backend (web-tree-sitter).
 *
 * Uses the `web-tree-sitter` npm package with a precompiled `.wasm` grammar.
 * No native compilation required -- this is the default for npm distribution.
 */

import * as path from 'path';
import { ParserTypes } from './types';

type WasmLanguage = {
    load(wasmPath: string): Promise<unknown>;
};

type WasmParserInstance = {
    parse(source: string): ParserTypes.Tree;
    setLanguage(language: unknown): void;
};

type WasmParserCtor = {
    new (): WasmParserInstance;
    init(): Promise<void>;
    Language?: WasmLanguage;
};

type WasmModule = {
    default?: WasmParserCtor;
    Parser?: WasmParserCtor;
    Language?: WasmLanguage;
    init?: () => Promise<void>;
};

export namespace WasmBackend {
    export function create(): ParserTypes.Backend {
        let parser: WasmParserInstance | null = null;

        return {
            async initialize(): Promise<void> {
                // Dynamic import so this module can be loaded without web-tree-sitter installed.
                // web-tree-sitter exports differ by context:
                //   - CJS compiled:  module.exports = Parser (constructor with .init, .Language)
                //   - Named exports: { Parser, Language, ... }
                const mod = (await import('web-tree-sitter')) as unknown as WasmModule;
                const Parser =
                    typeof mod.init === 'function' ? (mod as unknown as WasmParserCtor) : (mod.Parser ?? mod.default);
                if (!Parser) {
                    throw new Error('web-tree-sitter Parser export not found.');
                }
                const Language = Parser.Language ?? mod.Language;
                if (!Language) {
                    throw new Error('web-tree-sitter Language export not found.');
                }
                await Parser.init();

                parser = new Parser();

                // Resolve the .wasm grammar file.
                // In dist/: dist/parser/wasm.js -> dist/tree-sitter-blade.wasm (one level up)
                // In src/ (test): src/parser/wasm.ts -> tree-sitter-blade.wasm (two levels up)
                const fs = await import('node:fs');
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
