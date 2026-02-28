export namespace Lexer {
    export interface DirectiveToken {
        kind: 'directive';
        name: string;
        line: number;
        colStart: number;
        colEnd: number;
        offsetStart: number;
        offsetEnd: number;
    }

    export interface LexedSource {
        lines: string[];
        directiveTokens: DirectiveToken[];
    }

    function isDirectiveStartChar(ch: string | undefined): boolean {
        return !!ch && /[A-Za-z_]/.test(ch);
    }

    function isDirectiveChar(ch: string | undefined): boolean {
        return !!ch && /[A-Za-z0-9_]/.test(ch);
    }

    function isTagStartChar(ch: string | undefined): boolean {
        return !!ch && /[A-Za-z/!?]/.test(ch);
    }

    export function collectDirectiveTokens(source: string): DirectiveToken[] {
        const tokens: DirectiveToken[] = [];

        let i = 0;
        let line = 0;
        let col = 0;

        let inTag = false;
        let inTagQuote: 'single' | 'double' | null = null;
        let inBladeComment = false;
        let inHtmlComment = false;

        function advance(count: number): void {
            for (let n = 0; n < count && i < source.length; n++) {
                const ch = source[i++];
                if (ch === '\n') {
                    line++;
                    col = 0;
                    continue;
                }
                col++;
            }
        }

        while (i < source.length) {
            if (inBladeComment) {
                if (source.startsWith('--}}', i)) {
                    inBladeComment = false;
                    advance(4);
                    continue;
                }

                advance(1);
                continue;
            }

            if (inHtmlComment) {
                if (source.startsWith('-->', i)) {
                    inHtmlComment = false;
                    advance(3);
                    continue;
                }

                advance(1);
                continue;
            }

            const ch = source[i];

            if (source.startsWith('{{--', i)) {
                inBladeComment = true;
                advance(4);
                continue;
            }

            if (source.startsWith('<!--', i)) {
                inHtmlComment = true;
                advance(4);
                continue;
            }

            if (inTag) {
                if (inTagQuote === 'single') {
                    if (ch === "'" && source[i - 1] !== '\\') {
                        inTagQuote = null;
                    }
                    advance(1);
                    continue;
                }

                if (inTagQuote === 'double') {
                    if (ch === '"' && source[i - 1] !== '\\') {
                        inTagQuote = null;
                    }
                    advance(1);
                    continue;
                }

                if (ch === "'") {
                    inTagQuote = 'single';
                    advance(1);
                    continue;
                }

                if (ch === '"') {
                    inTagQuote = 'double';
                    advance(1);
                    continue;
                }

                if (ch === '>') {
                    inTag = false;
                    advance(1);
                    continue;
                }
            }

            if (ch === '<' && isTagStartChar(source[i + 1])) {
                inTag = true;
                advance(1);
                continue;
            }

            if (ch === '@' && isDirectiveStartChar(source[i + 1])) {
                const start = i;
                const startLine = line;
                const startCol = col;

                let j = i + 2;
                while (j < source.length && isDirectiveChar(source[j])) {
                    j++;
                }

                const name = source.slice(start, j);
                const length = j - i;

                tokens.push({
                    kind: 'directive',
                    name,
                    line: startLine,
                    colStart: startCol,
                    colEnd: startCol + length,
                    offsetStart: start,
                    offsetEnd: j,
                });

                advance(length);
                continue;
            }

            advance(1);
        }

        return tokens;
    }

    export function lexSource(source: string): LexedSource {
        return {
            lines: source.split('\n'),
            directiveTokens: collectDirectiveTokens(source),
        };
    }
}
