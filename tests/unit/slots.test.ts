import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { Shared } from '../../src/providers/shared';
import { Hovers } from '../../src/providers/hovers';
import { BladeParser } from '../../src/parser';
import { installMockLaravel, clearMockLaravel, withMockLaravel } from '../utils/laravel-mock';

describe('Slots', () => {
    beforeAll(async () => {
        await BladeParser.initialize('native');
    });

    // ─── extractSlotsFromContent ────────────────────────────────────────────

    describe('extractSlotsFromContent', () => {
        it('extracts props that are echoed standalone when @props exists', () => {
            const content = `@props(['header', 'footer' => null])
<div>{{ $header }}</div>
<div>{{ $slot }}</div>
@isset($footer)
    <div>{{ $footer }}</div>
@endisset`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toContain('header');
            expect(names).toContain('footer');
            expect(names).not.toContain('slot');
        });

        it('excludes props that are NOT echoed standalone', () => {
            const content = `@props(['color', 'size'])
<div class="{{ $color }}">
    <span>{{ $size }}</span>
</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            // 'color' is inside class="" attribute, so excluded
            expect(names).not.toContain('color');
            // 'size' is standalone inside <span>, so included
            expect(names).toContain('size');
        });

        it('returns all echoed vars when no @props directive exists', () => {
            const content = `<div>{{ $title }}</div>
<p>{{ $description }}</p>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toContain('title');
            expect(names).toContain('description');
        });

        it('excludes built-in variables', () => {
            const content = `<div>{{ $slot }}</div>
{{ $attributes }}
{{ $component }}
{{ $errors }}
{{ $loop }}
{{ $__env }}
{{ $__data }}
{{ $this }}
{{ $custom }}`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toEqual(['custom']);
        });

        it('handles {!! !!} unescaped echo syntax', () => {
            const content = `@props(['rawContent'])
<div>{!! $rawContent !!}</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toContain('rawContent');
        });

        it('handles echo with null coalescing operator', () => {
            const content = `@props(['header'])
<div>{{ $header ?? 'Default' }}</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toContain('header');
        });

        it('returns empty array for content with no echoed variables', () => {
            const content = `<div>
    <p>Static content only</p>
</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            expect(slots).toEqual([]);
        });

        it('handles variables inside attribute values (should exclude them)', () => {
            const content = `<div id="{{ $id }}" data-name="{{ $name }}">
    {{ $content }}
</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            expect(names).toContain('content');
            expect(names).not.toContain('id');
            expect(names).not.toContain('name');
        });

        it('handles @props with complex default values', () => {
            const content = `@props(['type' => 'info', 'message', 'icon' => null])
<div class="alert-{{ $type }}">
    {{ $message }}
    @if($icon)
        <i class="{{ $icon }}"></i>
    @endif
</div>`;
            const slots = Shared.extractSlotsFromContent(content);
            const names = slots.map((s) => s.name);
            // 'type' is inside attribute, excluded
            // 'message' is standalone, included
            // 'icon' is inside attribute, excluded
            expect(names).toContain('message');
            expect(names).not.toContain('type');
        });
    });

    // ─── findParentComponent edge cases ─────────────────────────────────────

    describe('findParentComponent', () => {
        it('finds parent across nested x-slot tags', () => {
            const source = `<x-card>
    <x-slot:header>
        <h1>Title</h1>
    </x-slot:header>
    <x-slot:footer>
        Footer
    </x-slot:footer>
</x-card>`;
            // Line 4 is inside <x-card> (the second slot)
            expect(Shared.findParentComponent(source, 4)).toBe('x-card');
        });

        it('handles namespaced components', () => {
            const source = `<flux:card>
    <x-slot:header>Title</x-slot:header>
</flux:card>`;
            expect(Shared.findParentComponent(source, 1)).toBe('flux:card');
        });

        it('returns the innermost parent for nested components', () => {
            const source = `<x-card>
    <x-inner>
        <x-slot:content>
            text
        </x-slot:content>
    </x-inner>
</x-card>`;
            expect(Shared.findParentComponent(source, 2)).toBe('x-inner');
        });

        it('returns null for line 0 with no component', () => {
            const source = '<div>test</div>';
            expect(Shared.findParentComponent(source, 0)).toBeNull();
        });

        it('skips self-closing component tags', () => {
            const source = `<x-layout>
    <x-button />
    <x-slot:sidebar>
        test
    </x-slot:sidebar>
</x-layout>`;
            // <x-button /> is self-closing, so it should not affect depth.
            expect(Shared.findParentComponent(source, 2)).toBe('x-layout');
        });

        it('skips self-closing tags without space before />', () => {
            const source = `<x-layout>
    <x-icon/>
    <x-slot:content>
        test
    </x-slot:content>
</x-layout>`;
            expect(Shared.findParentComponent(source, 2)).toBe('x-layout');
        });

        it('skips self-closing tags with attributes', () => {
            const source = `<x-layout>
    <x-button type="primary" :disabled="true" />
    <x-alert type="info" dismissible />
    <x-slot:content>
        test
    </x-slot:content>
</x-layout>`;
            expect(Shared.findParentComponent(source, 3)).toBe('x-layout');
        });

        it('skips namespaced self-closing tags', () => {
            const source = `<x-layout>
    <flux:icon name="check" />
    <x-slot:content>
        test
    </x-slot:content>
</x-layout>`;
            expect(Shared.findParentComponent(source, 2)).toBe('x-layout');
        });

        it('handles mix of self-closing and block components', () => {
            const source = `<x-layout>
    <x-button />
    <x-card>
        <x-icon />
        <x-slot:header>
            Title
        </x-slot:header>
    </x-card>
</x-layout>`;
            // Line 4 (<x-slot:header>) — parent should be x-card
            expect(Shared.findParentComponent(source, 4)).toBe('x-card');
        });
    });

    // ─── getSlotHover ───────────────────────────────────────────────────────

    describe('getSlotHover', () => {
        it('returns hover for colon syntax <x-slot:name>', () => {
            const source = '<x-card>\n    <x-slot:header>Title</x-slot:header>\n</x-card>';
            const tree = BladeParser.parse(source);
            const line = '    <x-slot:header>Title</x-slot:header>';
            const slotStart = line.indexOf('header');
            const hover = Hovers.getSlotHover(line, 1, slotStart, tree);
            expect(hover).not.toBeNull();
            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('header');
        });

        it('returns hover for name= syntax <x-slot name="footer">', () => {
            const source = '<x-card>\n    <x-slot name="footer">Content</x-slot>\n</x-card>';
            const tree = BladeParser.parse(source);
            const line = '    <x-slot name="footer">Content</x-slot>';
            const slotStart = line.indexOf('footer');
            const hover = Hovers.getSlotHover(line, 1, slotStart, tree);
            expect(hover).not.toBeNull();
            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('footer');
        });

        it('returns null when cursor is not on slot name', () => {
            const source = '<x-card>\n    <x-slot:header>Title</x-slot:header>\n</x-card>';
            const tree = BladeParser.parse(source);
            const line = '    <x-slot:header>Title</x-slot:header>';
            // Cursor at column 0, far from slot name
            const hover = Hovers.getSlotHover(line, 1, 0, tree);
            expect(hover).toBeNull();
        });

        it('returns "no parent component found" when not inside a component', () => {
            const source = '<div>\n    <x-slot:header>Title</x-slot:header>\n</div>';
            const tree = BladeParser.parse(source);
            const line = '    <x-slot:header>Title</x-slot:header>';
            const slotStart = line.indexOf('header');
            const hover = Hovers.getSlotHover(line, 1, slotStart, tree);
            expect(hover).not.toBeNull();
            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('No parent component found');
        });

        it('returns null for a line without any slot syntax', () => {
            const source = '<x-card>\n    <div>test</div>\n</x-card>';
            const tree = BladeParser.parse(source);
            const line = '    <div>test</div>';
            const hover = Hovers.getSlotHover(line, 1, 5, tree);
            expect(hover).toBeNull();
        });

        describe('with Laravel mock', () => {
            beforeEach(() => {
                installMockLaravel();
            });

            afterEach(() => {
                clearMockLaravel();
            });

            it('includes component path when component is found', () => {
                withMockLaravel(() => {
                    const source = '<x-button>\n    <x-slot:header>Title</x-slot:header>\n</x-button>';
                    const tree = BladeParser.parse(source);
                    const line = '    <x-slot:header>Title</x-slot:header>';
                    const slotStart = line.indexOf('header');
                    const hover = Hovers.getSlotHover(line, 1, slotStart, tree);
                    expect(hover).not.toBeNull();
                    const value =
                        typeof hover!.contents === 'string'
                            ? hover!.contents
                            : 'value' in hover!.contents
                              ? hover!.contents.value
                              : '';
                    expect(value).toContain('x-button');
                    expect(value).toContain('button.blade.php');
                });
            });

            it('shows "not found in project" for unknown component', () => {
                withMockLaravel(() => {
                    const source = '<x-unknown>\n    <x-slot:header>Title</x-slot:header>\n</x-unknown>';
                    const tree = BladeParser.parse(source);
                    const line = '    <x-slot:header>Title</x-slot:header>';
                    const slotStart = line.indexOf('header');
                    const hover = Hovers.getSlotHover(line, 1, slotStart, tree);
                    expect(hover).not.toBeNull();
                    const value =
                        typeof hover!.contents === 'string'
                            ? hover!.contents
                            : 'value' in hover!.contents
                              ? hover!.contents.value
                              : '';
                    expect(value).toContain('not found in project');
                });
            });
        });
    });
});
