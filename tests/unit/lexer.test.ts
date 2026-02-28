import { describe, it, expect } from 'vitest';
import { BladeLexer } from '../../src/providers/lexer';

describe('BladeLexer', () => {
    it('collects directive tokens in regular blade blocks', () => {
        const source = '@if($show)\n  <p>test</p>\n@endif';
        const tokens = BladeLexer.collectDirectiveTokens(source);
        expect(tokens.map((token) => token.name)).toEqual(['@if', '@endif']);
    });

    it('ignores directives inside blade and html comments', () => {
        const source = '{{-- @if($a) --}}\n<!-- @endif -->\n@if(true)\n@endif';
        const tokens = BladeLexer.collectDirectiveTokens(source);
        expect(tokens.map((token) => token.name)).toEqual(['@if', '@endif']);
    });

    it('ignores @ in quoted html attributes', () => {
        const source = '<input type="email" placeholder="name@example.com" @if($show) @endif />';
        const tokens = BladeLexer.collectDirectiveTokens(source);
        expect(tokens.map((token) => token.name)).toEqual(['@if', '@endif']);
    });

    it('does not treat less-than operator as html tag start', () => {
        const source = '@if($a < $b)\n@endif';
        const tokens = BladeLexer.collectDirectiveTokens(source);
        expect(tokens.map((token) => token.name)).toEqual(['@if', '@endif']);
    });
});
