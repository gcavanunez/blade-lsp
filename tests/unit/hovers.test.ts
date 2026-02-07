import { describe, it, expect } from 'vitest';
import { Hovers } from '../../src/providers/hovers';
import { BladeDirectives } from '../../src/directives';

describe('Hovers', () => {
    describe('formatDirective', () => {
        it('formats @if directive with all sections', () => {
            const directive = BladeDirectives.map.get('@if')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @if');
            expect(result).toContain(directive.description);
            expect(result).toContain('**Parameters:**');
            expect(result).toContain('**End tag:**');
            expect(result).toContain('@endif');
            expect(result).toContain('**Example:**');
        });

        it('formats @else directive without parameters or end tag', () => {
            const directive = BladeDirectives.map.get('@else')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @else');
            expect(result).toContain(directive.description);
            expect(result).not.toContain('**Parameters:**');
            expect(result).not.toContain('**End tag:**');
        });

        it('formats @foreach directive', () => {
            const directive = BladeDirectives.map.get('@foreach')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @foreach');
            expect(result).toContain('@endforeach');
        });
    });

    describe('formatLoopVariable', () => {
        it('returns markdown with all $loop properties', () => {
            const result = Hovers.formatLoopVariable();

            expect(result).toContain('$loop');
            expect(result).toContain('$loop->index');
            expect(result).toContain('$loop->iteration');
            expect(result).toContain('$loop->remaining');
            expect(result).toContain('$loop->count');
            expect(result).toContain('$loop->first');
            expect(result).toContain('$loop->last');
            expect(result).toContain('$loop->even');
            expect(result).toContain('$loop->odd');
            expect(result).toContain('$loop->depth');
            expect(result).toContain('$loop->parent');
        });
    });

    describe('formatSlotVariable', () => {
        it('returns markdown with slot description', () => {
            const result = Hovers.formatSlotVariable();

            expect(result).toContain('$slot');
            expect(result).toContain('component');
        });
    });

    describe('formatAttributesVariable', () => {
        it('returns markdown with attributes methods', () => {
            const result = Hovers.formatAttributesVariable();

            expect(result).toContain('$attributes');
            expect(result).toContain('merge()');
            expect(result).toContain('class()');
            expect(result).toContain('only()');
            expect(result).toContain('except()');
        });
    });

    describe('getWordAtPosition', () => {
        it('extracts $loop from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $loop->index }}', 5);
            expect(result).toMatch(/^\$loop/);
        });

        it('extracts $slot from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $slot }}', 5);
            expect(result).toBe('$slot');
        });

        it('extracts $attributes from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $attributes->merge([]) }}', 5);
            expect(result).toMatch(/^\$attributes/);
        });

        it('returns empty string for non-word position', () => {
            const result = Hovers.getWordAtPosition('   ', 1);
            expect(result).toBe('');
        });
    });
});
