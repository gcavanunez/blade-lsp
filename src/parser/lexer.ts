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

    export interface OffsetRange {
        offsetStart: number;
        offsetEnd: number;
    }

    export interface LexedSource {
        lines: string[];
        directiveTokens: DirectiveToken[];
        phpRanges: OffsetRange[];
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

    function isInlinePhpDirectiveInvocation(source: string, offsetAfterDirective: number): boolean {
        return /^\s*\(/.test(source.slice(offsetAfterDirective));
    }

    function scan(source: string): { directiveTokens: DirectiveToken[]; phpRanges: OffsetRange[] } {
        const tokens: DirectiveToken[] = [];
        const phpRanges: OffsetRange[] = [];

        let i = 0;
        let line = 0;
        let col = 0;

        let inTag = false;
        let inTagQuote: 'single' | 'double' | null = null;
        let inBladeComment = false;
        let inHtmlComment = false;

        let inPhpTag = false;
        let phpTagStart = -1;
        let phpTagQuote: 'single' | 'double' | null = null;
        let inPhpTagLineComment = false;
        let inPhpTagBlockComment = false;

        let inBladePhpBlock = false;
        let bladePhpBlockStart = -1;

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

            if (inPhpTag) {
                const ch = source[i];
                const prev = i > 0 ? source[i - 1] : '';

                if (inPhpTagLineComment) {
                    if (ch === '\n') {
                        inPhpTagLineComment = false;
                    }
                    advance(1);
                    continue;
                }

                if (inPhpTagBlockComment) {
                    if (source.startsWith('*/', i)) {
                        inPhpTagBlockComment = false;
                        advance(2);
                        continue;
                    }

                    advance(1);
                    continue;
                }

                if (phpTagQuote === 'single') {
                    if (ch === "'" && prev !== '\\') {
                        phpTagQuote = null;
                    }
                    advance(1);
                    continue;
                }

                if (phpTagQuote === 'double') {
                    if (ch === '"' && prev !== '\\') {
                        phpTagQuote = null;
                    }
                    advance(1);
                    continue;
                }

                if (source.startsWith('?>', i)) {
                    inPhpTag = false;
                    advance(2);
                    if (phpTagStart >= 0) {
                        phpRanges.push({ offsetStart: phpTagStart, offsetEnd: i });
                    }
                    phpTagStart = -1;
                    continue;
                }

                if (source.startsWith('/*', i)) {
                    inPhpTagBlockComment = true;
                    advance(2);
                    continue;
                }

                if (source.startsWith('//', i) || ch === '#') {
                    inPhpTagLineComment = true;
                    advance(1);
                    continue;
                }

                if (ch === "'") {
                    phpTagQuote = 'single';
                    advance(1);
                    continue;
                }

                if (ch === '"') {
                    phpTagQuote = 'double';
                    advance(1);
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

            if (source.startsWith('<?', i)) {
                inPhpTag = true;
                phpTagStart = i;
                phpTagQuote = null;
                inPhpTagLineComment = false;
                inPhpTagBlockComment = false;
                advance(2);
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

                const token: DirectiveToken = {
                    kind: 'directive',
                    name,
                    line: startLine,
                    colStart: startCol,
                    colEnd: startCol + length,
                    offsetStart: start,
                    offsetEnd: j,
                };

                if (inBladePhpBlock) {
                    if (name === '@endphp') {
                        if (bladePhpBlockStart >= 0 && bladePhpBlockStart <= token.offsetStart) {
                            phpRanges.push({
                                offsetStart: bladePhpBlockStart,
                                offsetEnd: token.offsetStart,
                            });
                        }
                        inBladePhpBlock = false;
                        bladePhpBlockStart = -1;
                        tokens.push(token);
                    }

                    advance(length);
                    continue;
                }

                tokens.push(token);

                if (name === '@php' && !isInlinePhpDirectiveInvocation(source, token.offsetEnd)) {
                    inBladePhpBlock = true;
                    bladePhpBlockStart = token.offsetEnd;
                }

                advance(length);
                continue;
            }

            advance(1);
        }

        if (inPhpTag && phpTagStart >= 0) {
            phpRanges.push({ offsetStart: phpTagStart, offsetEnd: source.length });
        }

        if (inBladePhpBlock && bladePhpBlockStart >= 0) {
            phpRanges.push({ offsetStart: bladePhpBlockStart, offsetEnd: source.length });
        }

        return { directiveTokens: tokens, phpRanges };
    }

    export function collectDirectiveTokens(source: string): DirectiveToken[] {
        return scan(source).directiveTokens;
    }

    function applyPhpMask(source: string, ranges: OffsetRange[]): string {
        if (ranges.length === 0) return source;

        const chars = source.split('');
        for (const range of ranges) {
            const start = Math.max(0, range.offsetStart);
            const end = Math.min(source.length, range.offsetEnd);
            for (let i = start; i < end; i++) {
                if (chars[i] !== '\n' && chars[i] !== '\r') {
                    chars[i] = ' ';
                }
            }
        }

        return chars.join('');
    }

    export function maskPhpContent(source: string): string {
        const { phpRanges } = scan(source);
        return applyPhpMask(source, phpRanges);
    }

    export function lexSource(source: string): LexedSource {
        const { directiveTokens, phpRanges } = scan(source);

        return {
            lines: source.split('\n'),
            directiveTokens,
            phpRanges,
        };
    }
}
