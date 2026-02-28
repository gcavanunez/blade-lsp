import { BladeLexer } from './lexer';

export namespace BladeAnalysis {
    export interface SourceAnalysis {
        source: string;
        lines: string[];
        directiveTokens: BladeLexer.DirectiveToken[];
    }

    export function build(source: string): SourceAnalysis {
        return {
            source,
            lines: source.split('\n'),
            directiveTokens: BladeLexer.collectDirectiveTokens(source),
        };
    }
}
