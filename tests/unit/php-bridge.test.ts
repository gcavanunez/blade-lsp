import { describe, expect, it } from 'vitest';
import { Position, Range } from 'vscode-languageserver/node';
import { Lexer } from '../../src/parser/lexer';
import { PhpBridgeRegions } from '../../src/providers/php-bridge/regions';
import { PhpBridgeShadowDocument } from '../../src/providers/php-bridge/shadow-document';
import { PhpBridgeMapping } from '../../src/providers/php-bridge/mapping';
import { PhpBridgeStore } from '../../src/providers/php-bridge/store';

describe('PhpBridge foundation', () => {
    const source = `<?php
use App\\Models\\Post;

render(function (Post $post) {
    $photos = $post->author->photos;
});
?>

<div>{{ $post->title }}</div>

@php
$foo = bar();
@endphp
`;

    it('extracts php-tag and blade-directive regions with inner content offsets', () => {
        const extraction = PhpBridgeRegions.extract(source, Lexer.lexSource(source));

        expect(extraction.regions).toHaveLength(2);
        expect(extraction.regions[0].kind).toBe('php-tag');
        expect(extraction.regions[1].kind).toBe('blade-directive');
        expect(extraction.regions[0].content.startsWith('\nuse App\\Models\\Post;')).toBe(true);
        expect(extraction.regions[1].content.trim()).toBe('$foo = bar();');
    });

    it('builds a stable human-readable shadow document path and stitched content', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );

        expect(shadow.shadowPath).toBe('/workspace/.blade-lsp/shadow/resources-views-posts-show.php');
        expect(shadow.content.startsWith('<?php\n/* blade-region:1 */\n')).toBe(true);
        expect(shadow.content).toContain('/* blade-region:2 */');
        expect(shadow.regions).toHaveLength(2);
    });

    it('maps blade positions into shadow positions and back', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );

        const bladePosition = Position.create(3, 23);
        const mapped = PhpBridgeMapping.bladePositionToShadowPosition(source, shadow, bladePosition);
        expect(mapped.kind).toBe('mapped');

        if (mapped.kind === 'mapped') {
            const roundTrip = PhpBridgeMapping.shadowPositionToBladePosition(source, shadow, mapped.position);
            expect(roundTrip.kind).toBe('mapped');
            if (roundTrip.kind === 'mapped') {
                expect(roundTrip.position).toEqual(bladePosition);
            }
        }
    });

    it('marks synthetic shadow text as non-mappable', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );

        const synthetic = PhpBridgeMapping.shadowPositionToBladePosition(source, shadow, Position.create(0, 3));
        expect(synthetic.kind).toBe('synthetic');
    });

    it('maps ranges only when they stay inside one region', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );

        const valid = PhpBridgeMapping.bladeRangeToShadowRange(
            source,
            shadow,
            Range.create(Position.create(3, 17), Position.create(3, 28)),
        );
        expect(valid.kind).toBe('mapped');

        const invalid = PhpBridgeMapping.shadowRangeToBladeRange(
            source,
            shadow,
            Range.create(Position.create(1, 0), Position.create(11, 1)),
        );
        expect(invalid.kind).toBe('synthetic');
    });

    it('stores shadow documents by blade uri and version', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );
        const store = PhpBridgeStore.create();

        store.set({
            bladeUri: shadow.bladeUri,
            version: 3,
            source,
            signature: extraction.signature,
            shadow,
        });

        expect(store.get(shadow.bladeUri, 2, source)).toBeNull();
        expect(store.get(shadow.bladeUri, 3, 'changed')).toBeNull();
        expect(store.get(shadow.bladeUri, 3, source)?.shadow.shadowUri).toBe(shadow.shadowUri);

        store.clear(shadow.bladeUri);
        expect(store.get(shadow.bladeUri, 3, source)).toBeNull();
    });
});
