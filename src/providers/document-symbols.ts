import { DocumentSymbol, Range, SymbolKind } from 'vscode-languageserver/node';

export namespace DocumentSymbols {
    interface MatchResult {
        name: string;
        start: number;
        end: number;
        kind: SymbolKind;
        detail: string;
    }

    function pushSymbol(symbols: DocumentSymbol[], line: number, match: MatchResult): void {
        symbols.push({
            name: match.name,
            detail: match.detail,
            kind: match.kind,
            range: Range.create(line, 0, line, Math.max(match.end, match.start + 1)),
            selectionRange: Range.create(line, match.start, line, match.end),
        });
    }

    function collectDirectiveMatches(line: string, pattern: RegExp, kind: SymbolKind, detail: string): MatchResult[] {
        const results: MatchResult[] = [];
        pattern.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            if (!match[1]) continue;

            const name = match[1];
            const start = line.indexOf(name, match.index ?? 0);
            results.push({
                name,
                start,
                end: start + name.length,
                kind,
                detail,
            });
        }

        return results;
    }

    function collectComponentMatches(line: string): MatchResult[] {
        const pattern = /<(x-[\w.-]+(?:::[\w.-]+)?|livewire:[\w.-]+|[\w]+:[\w.-]+)(?=[\s/>])/g;
        const results: MatchResult[] = [];

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            if (!match[1]) continue;

            const tag = match[1];
            const start = (match.index ?? 0) + 1;
            results.push({
                name: tag,
                start,
                end: start + tag.length,
                kind: SymbolKind.Class,
                detail: tag.startsWith('livewire:') ? 'Livewire component' : 'Blade component',
            });
        }

        return results.filter((item) => item.name !== 'x-slot' && !item.name.startsWith('x-slot:'));
    }

    function collectSlotMatches(line: string): MatchResult[] {
        return [
            ...collectDirectiveMatches(line, /<x-slot:([\w-]+)/g, SymbolKind.Field, 'Blade slot'),
            ...collectDirectiveMatches(line, /<x-slot\s+name=["']([\w-]+)["']/g, SymbolKind.Field, 'Blade slot'),
        ];
    }

    export function getSymbols(source: string): DocumentSymbol[] {
        const symbols: DocumentSymbol[] = [];
        const lines = source.split('\n');

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];

            for (const match of collectDirectiveMatches(
                line,
                /@(?:section|yield)\s*\(\s*["']([^"']+)["']/g,
                SymbolKind.Namespace,
                'Blade section',
            )) {
                pushSymbol(symbols, lineNumber, match);
            }

            for (const match of collectDirectiveMatches(
                line,
                /@(?:stack|push|pushOnce|prepend|prependOnce)\s*\(\s*["']([^"']+)["']/g,
                SymbolKind.Array,
                'Blade stack',
            )) {
                pushSymbol(symbols, lineNumber, match);
            }

            for (const match of collectComponentMatches(line)) {
                pushSymbol(symbols, lineNumber, match);
            }

            for (const match of collectSlotMatches(line)) {
                pushSymbol(symbols, lineNumber, match);
            }
        }

        return symbols;
    }
}
