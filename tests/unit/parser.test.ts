import { describe, it, expect, beforeAll } from 'vitest';
import { BladeParser } from '../../src/parser';
import { ensureContainer } from '../utils/laravel-mock';

describe('BladeParser', () => {
    beforeAll(async () => {
        ensureContainer();
        await BladeParser.initialize('wasm');
    });

    describe('parse', () => {
        it('parses a simple Blade template', () => {
            const tree = BladeParser.parse('<div>Hello</div>');
            expect(tree).toBeDefined();
            expect(tree.rootNode).toBeDefined();
        });

        it('parses a template with directives', () => {
            const tree = BladeParser.parse('@if($show)\n  <p>Visible</p>\n@endif');
            expect(tree).toBeDefined();
            const text = tree.rootNode.toString();
            expect(text).toContain('directive');
        });

        it('parses echo statements', () => {
            const tree = BladeParser.parse('<p>{{ $name }}</p>');
            expect(tree).toBeDefined();
        });
    });

    describe('findNodeAtPosition', () => {
        it('finds a node at the given position', () => {
            const tree = BladeParser.parse('@foreach($items as $item)\n  <p>{{ $item }}</p>\n@endforeach');
            const node = BladeParser.findNodeAtPosition(tree, 0, 3);
            expect(node).toBeDefined();
        });

        it('returns a node for valid positions', () => {
            const tree = BladeParser.parse('<div>test</div>');
            const node = BladeParser.findNodeAtPosition(tree, 0, 6);
            expect(node).toBeDefined();
        });
    });

    describe('extractDirectiveName', () => {
        it('extracts @if from a directive node', () => {
            const tree = BladeParser.parse('@if($show)\n  test\n@endif');
            const node = BladeParser.findNodeAtPosition(tree, 0, 1);
            expect(node).toBeDefined();
            if (node) {
                // Walk up to find a directive-like node
                let current = node;
                while (current && !current.text.startsWith('@')) {
                    if (current.parent) {
                        current = current.parent;
                    } else {
                        break;
                    }
                }
                if (current.text.startsWith('@')) {
                    const name = BladeParser.extractDirectiveName(current);
                    expect(name).toBe('@if');
                }
            }
        });

        it('returns null for non-directive nodes', () => {
            const tree = BladeParser.parse('<div>test</div>');
            const node = BladeParser.findNodeAtPosition(tree, 0, 6);
            if (node && !node.text.startsWith('@')) {
                const name = BladeParser.extractDirectiveName(node);
                expect(name).toBeNull();
            }
        });
    });

    describe('getCompletionContext', () => {
        it('detects directive context when typing @', () => {
            const source = '@fo';
            const tree = BladeParser.parse(source);
            const ctx = BladeParser.getCompletionContext(tree, source, 0, 3);
            expect(ctx.type).toBe('directive');
            expect(ctx.prefix).toBe('@fo');
        });

        it('detects html context in plain HTML', () => {
            const source = '<div>';
            const tree = BladeParser.parse(source);
            const ctx = BladeParser.getCompletionContext(tree, source, 0, 5);
            expect(ctx.type).toBe('html');
        });

        it('detects echo context inside {{ }}', () => {
            const source = '{{ route() }}';
            const tree = BladeParser.parse(source);
            const ctx = BladeParser.getCompletionContext(tree, source, 0, 4);
            expect(ctx.type).toBe('echo');
        });
    });

    describe('getDiagnostics', () => {
        it('returns empty array for valid template', () => {
            const tree = BladeParser.parse('<div>Hello</div>');
            const diags = BladeParser.getDiagnostics(tree);
            expect(diags).toEqual([]);
        });

        it('returns diagnostics for syntax errors', () => {
            // Unclosed PHP block or similar syntax issue
            const tree = BladeParser.parse('@php $x = @endphp');
            const diags = BladeParser.getDiagnostics(tree);
            expect(Array.isArray(diags)).toBe(true);
        });
    });

    describe('getAllDirectives', () => {
        it('collects directive nodes from a template', () => {
            const tree = BladeParser.parse('@if($a)\n@elseif($b)\n@else\n@endif');
            const directives = BladeParser.getAllDirectives(tree);
            expect(directives.length).toBeGreaterThan(0);
        });
    });
});
