import { describe, it, expect } from 'vitest';
import { Shared } from '../../src/providers/shared';

describe('Shared', () => {
    describe('getComponentPropContext', () => {
        it('detects cursor inside a component tag', () => {
            const source = '<x-button type="primary" >';
            // Cursor after the space before >
            const result = Shared.getComponentPropContext(source, 0, 25);
            expect(result).not.toBeNull();
            expect(result!.componentName).toBe('x-button');
        });

        it('extracts existing props', () => {
            const source = '<x-button type="primary" variant="danger" >';
            const result = Shared.getComponentPropContext(source, 0, 42);
            expect(result).not.toBeNull();
            expect(result!.existingProps).toContain('type');
            expect(result!.existingProps).toContain('variant');
        });

        it('returns null when not in a component tag', () => {
            const source = '<div class="test">';
            const result = Shared.getComponentPropContext(source, 0, 17);
            expect(result).toBeNull();
        });

        it('handles namespaced component tags', () => {
            const source = '<flux:button variant="primary" >';
            const result = Shared.getComponentPropContext(source, 0, 31);
            expect(result).not.toBeNull();
            expect(result!.componentName).toBe('flux:button');
        });

        it('skips x-slot tags', () => {
            const source = '<x-slot name="header">';
            const result = Shared.getComponentPropContext(source, 0, 21);
            expect(result).toBeNull();
        });

        it('handles multiline component tags', () => {
            const source = '<x-button\n    type="primary"\n    >';
            // Cursor on the third line before >
            const result = Shared.getComponentPropContext(source, 2, 4);
            expect(result).not.toBeNull();
            expect(result!.componentName).toBe('x-button');
        });

        it('ignores > inside quoted attribute values (PHP arrow operator)', () => {
            const source =
                '<x-delete-confirmation-modal\n' +
                '        :id="\'delete-user-\' . $user->id"\n' +
                '        title="Delete User"\n' +
                '        message="Are you sure?"\n' +
                '    >';
            // Cursor on 'title' (line 2, column 10)
            const result = Shared.getComponentPropContext(source, 2, 10);
            expect(result).not.toBeNull();
            expect(result!.componentName).toBe('x-delete-confirmation-modal');
        });

        it('ignores > inside quoted values for all prop positions', () => {
            const source =
                '<x-modal\n' +
                '    :items="$collection->filter(fn($x) => $x->active)"\n' +
                '    title="Test"\n' +
                '    >';
            // Cursor on 'title' (line 2)
            const result = Shared.getComponentPropContext(source, 2, 6);
            expect(result).not.toBeNull();
            expect(result!.componentName).toBe('x-modal');
            expect(result!.existingProps).toContain('items');
        });
    });

    describe('findParentComponent', () => {
        it('finds the parent component for a nested element', () => {
            const source = '<x-card>\n    <x-slot:header>\n        test\n    </x-slot:header>\n</x-card>';
            const result = Shared.findParentComponent(source, 1);
            expect(result).not.toBeNull();
            expect(result).toBe('x-card');
        });

        it('returns null when no parent component', () => {
            const source = '<div>\n    test\n</div>';
            const result = Shared.findParentComponent(source, 1);
            expect(result).toBeNull();
        });
    });
});
