import { describe, it, expect } from 'vitest';
import { BladeDirectives } from '../../src/directives';

describe('BladeDirectives', () => {
    describe('all', () => {
        it('contains directive definitions', () => {
            expect(BladeDirectives.all.length).toBeGreaterThan(0);
        });

        it('has at least 50 directives', () => {
            // Laravel ships ~70 built-in directives
            expect(BladeDirectives.all.length).toBeGreaterThanOrEqual(50);
        });

        it('every directive has a name starting with @ (except comment)', () => {
            for (const directive of BladeDirectives.all) {
                // The comment directive {{-- is the exception
                if (directive.name === '{{--') continue;
                expect(directive.name).toMatch(/^@\w+$/);
            }
        });

        it('every directive has a description', () => {
            for (const directive of BladeDirectives.all) {
                expect(directive.description).toBeTruthy();
                expect(typeof directive.description).toBe('string');
            }
        });
    });

    describe('map', () => {
        it('contains all directives by name', () => {
            expect(BladeDirectives.map.size).toBe(BladeDirectives.all.length);
        });

        it('looks up @if correctly', () => {
            const directive = BladeDirectives.map.get('@if');
            expect(directive).toBeDefined();
            expect(directive!.name).toBe('@if');
            expect(directive!.hasEndTag).toBe(true);
            expect(directive!.endTag).toBe('@endif');
            expect(directive!.parameters).toBeDefined();
        });

        it('looks up @foreach correctly', () => {
            const directive = BladeDirectives.map.get('@foreach');
            expect(directive).toBeDefined();
            expect(directive!.name).toBe('@foreach');
            expect(directive!.hasEndTag).toBe(true);
            expect(directive!.endTag).toBe('@endforeach');
        });

        it('looks up @extends correctly', () => {
            const directive = BladeDirectives.map.get('@extends');
            expect(directive).toBeDefined();
            expect(directive!.name).toBe('@extends');
        });

        it('looks up @include correctly', () => {
            const directive = BladeDirectives.map.get('@include');
            expect(directive).toBeDefined();
            expect(directive!.name).toBe('@include');
        });

        it('returns undefined for non-existent directive', () => {
            expect(BladeDirectives.map.get('@nonexistent')).toBeUndefined();
        });
    });

    describe('getMatching', () => {
        it('returns directives matching a prefix', () => {
            const results = BladeDirectives.getMatching('@if');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some((d) => d.name === '@if')).toBe(true);
        });

        it('returns @if, @isset, @include variants for "@i" prefix', () => {
            const results = BladeDirectives.getMatching('@i');
            const names = results.map((d) => d.name);
            expect(names).toContain('@if');
            expect(names).toContain('@include');
        });

        it('returns all @-prefixed directives for "@" prefix', () => {
            const results = BladeDirectives.getMatching('@');
            // All directives except the comment {{-- start with @
            const atDirectives = BladeDirectives.all.filter((d) => d.name.startsWith('@'));
            expect(results.length).toBe(atDirectives.length);
        });

        it('is case-insensitive', () => {
            const results = BladeDirectives.getMatching('@IF');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some((d) => d.name === '@if')).toBe(true);
        });

        it('returns empty array for unmatched prefix', () => {
            const results = BladeDirectives.getMatching('@zzz');
            expect(results).toEqual([]);
        });

        it('matches @foreach directives', () => {
            const results = BladeDirectives.getMatching('@for');
            const names = results.map((d) => d.name);
            expect(names).toContain('@for');
            expect(names).toContain('@foreach');
            expect(names).toContain('@forelse');
        });
    });
});
