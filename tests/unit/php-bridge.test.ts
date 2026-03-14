import { describe, expect, it } from 'vitest';
import { Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
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

    it('builds a stable human-readable shadow document path and simplified content', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );

        expect(shadow.shadowPath).toBe('/workspace/vendor/blade-lsp/shadow/resources-views-posts-show.php');
        expect(shadow.content.startsWith('<?php\n\nuse App\\Models\\Post;')).toBe(true);
        expect(shadow.content).not.toContain('blade-region');
        expect(shadow.regions).toHaveLength(2);
    });

    it('maintains natural region order even when active region is specified', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
            { activeRegionId: 'blade-region:2' },
        );

        expect(shadow.activeRegionId).toBe('blade-region:2');
        expect(shadow.content.startsWith('<?php\n\nuse App\\Models\\Post;')).toBe(true);
        expect(shadow.shadowPath).toBe('/workspace/vendor/blade-lsp/shadow/resources-views-posts-show.php');
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
        expect(invalid.kind).toBe('unmappable');
    });

    it('stores persistent bridge document state per blade uri', () => {
        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(
            '/workspace',
            'file:///workspace/resources/views/posts/show.blade.php',
            extraction,
        );
        const store = PhpBridgeStore.create();
        const document = TextDocument.create(shadow.bladeUri, 'blade', 3, source);

        const applied = store.apply(document, extraction, shadow, null);

        expect(applied.phpChanged).toBe(true);
        expect(store.get(shadow.bladeUri)?.bladeVersion).toBe(3);
        expect(store.get(shadow.bladeUri)?.extraction.signature).toBe(extraction.signature);

        store.markBackendSynced(shadow.bladeUri, 7);
        expect(store.get(shadow.bladeUri)?.backendSyncedVersion).toBe(7);

        const reapplied = store.apply(
            TextDocument.create(shadow.bladeUri, 'blade', 4, source),
            extraction,
            shadow,
            null,
        );
        expect(reapplied.phpChanged).toBe(false);
        expect(reapplied.state.backendSyncedVersion).toBe(7);

        const reordered = store.apply(
            TextDocument.create(shadow.bladeUri, 'blade', 5, source),
            extraction,
            PhpBridgeShadowDocument.build('/workspace', shadow.bladeUri, extraction, {
                activeRegionId: 'blade-region:2',
            }),
            'blade-region:2',
        );
        expect(reordered.phpChanged).toBe(true);
        expect(reordered.state.activeRegionId).toBe('blade-region:2');
        expect(reordered.state.backendSyncedVersion).toBeNull();

        expect(store.get('file:///workspace/other.blade.php')).toBeNull();

        store.clear(shadow.bladeUri);
        expect(store.get(shadow.bladeUri)).toBeNull();
    });
});
