import { CompletionItem, CompletionItemKind, MarkupKind } from 'vscode-languageserver/node';
import { Lexer } from '../parser/lexer';

export namespace PhpPreambleSymbols {
    export type SymbolSource = 'assignment' | 'folio-param' | 'view-with' | 'livewire-prop';

    export interface TemplateSymbol {
        name: string;
        type: string | null;
        source: SymbolSource;
    }

    function addSymbol(symbols: Map<string, TemplateSymbol>, symbol: TemplateSymbol): void {
        if (!symbol.name.startsWith('$')) return;

        const existing = symbols.get(symbol.name);
        if (!existing) {
            symbols.set(symbol.name, symbol);
            return;
        }

        if (!existing.type && symbol.type) {
            symbols.set(symbol.name, symbol);
        }
    }

    function normalizeType(value: string | undefined): string | null {
        const trimmed = value?.trim();
        return trimmed ? trimmed.replace(/^\\+/, '') : null;
    }

    function collectFolioRenderParams(text: string, symbols: Map<string, TemplateSymbol>): void {
        const pattern = /render\s*\(\s*function\s*\(([^)]*)\)/g;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(text)) !== null) {
            const params = match[1]?.split(',') ?? [];
            for (const param of params) {
                const paramMatch = param.match(/^(?:\s*(?:readonly\s+)?(?:[A-Za-z_\\][\w\\|?&]*)\s+)?(\$\w+)/);
                if (!paramMatch?.[1]) continue;

                const name = paramMatch[1];
                const typeMatch = param.match(/^\s*(?:readonly\s+)?([A-Za-z_\\][\w\\|?&]*)\s+\$\w+/);
                const type = normalizeType(typeMatch?.[1]);

                if (name === '$view' && type?.endsWith('View')) {
                    continue;
                }

                addSymbol(symbols, {
                    name,
                    type,
                    source: 'folio-param',
                });
            }
        }
    }

    function collectViewWithSymbols(text: string, symbols: Map<string, TemplateSymbol>): void {
        const singlePattern = /->with\s*\(\s*['"]([^'"]+)['"]\s*,/g;
        let match: RegExpExecArray | null;
        while ((match = singlePattern.exec(text)) !== null) {
            addSymbol(symbols, {
                name: `$${match[1]}`,
                type: null,
                source: 'view-with',
            });
        }

        const arrayPattern = /->with\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
        while ((match = arrayPattern.exec(text)) !== null) {
            const body = match[1] ?? '';
            const keyPattern = /['"]([^'"]+)['"]\s*=>/g;
            let keyMatch: RegExpExecArray | null;
            while ((keyMatch = keyPattern.exec(body)) !== null) {
                addSymbol(symbols, {
                    name: `$${keyMatch[1]}`,
                    type: null,
                    source: 'view-with',
                });
            }
        }
    }

    function collectLivewireProps(text: string, symbols: Map<string, TemplateSymbol>): void {
        const pattern = /\bpublic\s+(?:static\s+)?(?:readonly\s+)?(?:([A-Za-z_\\][\w\\|?&]*)\s+)?(\$\w+)\s*(?:=|;)/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            addSymbol(symbols, {
                name: match[2],
                type: normalizeType(match[1]),
                source: 'livewire-prop',
            });
        }
    }

    function updateBraceDepth(line: string, depth: number): number {
        let nextDepth = depth;
        let quote: "'" | '"' | null = null;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const prev = i > 0 ? line[i - 1] : '';

            if (quote) {
                if (ch === quote && prev !== '\\') {
                    quote = null;
                }
                continue;
            }

            if (ch === '/' && line[i + 1] === '/') break;
            if (ch === '#') break;
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }

            if (ch === '{') nextDepth++;
            if (ch === '}') nextDepth = Math.max(0, nextDepth - 1);
        }

        return nextDepth;
    }

    function collectTopLevelAssignments(text: string, symbols: Map<string, TemplateSymbol>): void {
        const lines = text.split('\n');
        let depth = 0;

        for (const line of lines) {
            if (depth === 0) {
                const match = line.match(/^\s*(\$\w+)\s*=/);
                if (match?.[1]) {
                    addSymbol(symbols, {
                        name: match[1],
                        type: null,
                        source: 'assignment',
                    });
                }
            }

            depth = updateBraceDepth(line, depth);
        }
    }

    export function getSymbols(source: string): TemplateSymbol[] {
        const lexed = Lexer.lexSource(source);
        const symbols = new Map<string, TemplateSymbol>();

        for (const range of lexed.phpRanges) {
            const text = source.slice(range.offsetStart, range.offsetEnd);
            collectFolioRenderParams(text, symbols);
            collectViewWithSymbols(text, symbols);
            collectLivewireProps(text, symbols);
            collectTopLevelAssignments(text, symbols);
        }

        return [...symbols.values()];
    }

    function sourceDetail(source: SymbolSource): string {
        switch (source) {
            case 'folio-param':
                return 'Folio render parameter';
            case 'view-with':
                return 'View data from with(...)';
            case 'livewire-prop':
                return 'Livewire public property';
            case 'assignment':
                return 'PHP preamble variable';
        }
    }

    export function findSymbol(source: string, name: string): TemplateSymbol | null {
        return getSymbols(source).find((symbol) => symbol.name === name) ?? null;
    }

    export function toCompletionItems(source: string): CompletionItem[] {
        return getSymbols(source).map((symbol) => ({
            label: symbol.name,
            kind: CompletionItemKind.Variable,
            detail: sourceDetail(symbol.source),
            documentation: {
                kind: MarkupKind.Markdown,
                value: formatSymbol(symbol),
            },
            sortText: `0${symbol.name}`,
        }));
    }

    export function formatSymbol(symbol: TemplateSymbol): string {
        let content = `## ${symbol.name}\n\n`;
        content += `**Source:** ${sourceDetail(symbol.source)}\n`;
        if (symbol.type) {
            content += `\n**Type:** \`${symbol.type}\`\n`;
        }
        return content;
    }
}
