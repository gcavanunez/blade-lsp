/**
 * Baseline benchmarks for shadow document construction.
 *
 * Measures the cost of full region extraction + shadow document build,
 * which happens on every keystroke in a PHP region today.
 *
 * After PR 6 (incremental shadow updates), add comparison benchmarks here.
 */

import { bench, describe } from 'vitest';
import { PhpBridgeRegions } from '../../src/providers/php-bridge/regions';
import { PhpBridgeShadowDocument } from '../../src/providers/php-bridge/shadow-document';
import { Lexer } from '../../src/parser/lexer';
import { TEMPLATE_5_REGIONS, TEMPLATE_10_REGIONS, TEMPLATE_20_REGIONS, prepareExtraction } from '../fixtures';

const WORKSPACE_ROOT = '/test/project';
const BLADE_URI = 'file:///test/project/resources/views/bench.blade.php';

// Pre-compute lexed sources so we can benchmark extraction separately from lexing
const lexed5 = Lexer.lexSource(TEMPLATE_5_REGIONS);
const lexed10 = Lexer.lexSource(TEMPLATE_10_REGIONS);
const lexed20 = Lexer.lexSource(TEMPLATE_20_REGIONS);

// Pre-compute extractions for benchmarking build separately from extraction
const ext5 = prepareExtraction(TEMPLATE_5_REGIONS);
const ext10 = prepareExtraction(TEMPLATE_10_REGIONS);
const ext20 = prepareExtraction(TEMPLATE_20_REGIONS);

describe('lexSource — tokenize blade template', () => {
    bench('5 PHP regions', () => {
        Lexer.lexSource(TEMPLATE_5_REGIONS);
    });

    bench('10 PHP regions', () => {
        Lexer.lexSource(TEMPLATE_10_REGIONS);
    });

    bench('20 PHP regions', () => {
        Lexer.lexSource(TEMPLATE_20_REGIONS);
    });
});

describe('region extraction — extract PHP regions from lexed source', () => {
    bench('5 regions', () => {
        PhpBridgeRegions.extract(TEMPLATE_5_REGIONS, lexed5);
    });

    bench('10 regions', () => {
        PhpBridgeRegions.extract(TEMPLATE_10_REGIONS, lexed10);
    });

    bench('20 regions', () => {
        PhpBridgeRegions.extract(TEMPLATE_20_REGIONS, lexed20);
    });
});

describe('shadow document build — assemble PHP shadow file', () => {
    bench('5 regions', () => {
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, ext5);
    });

    bench('10 regions', () => {
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, ext10);
    });

    bench('20 regions', () => {
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, ext20);
    });
});

describe('full pipeline — lex + extract + build (current per-keystroke cost)', () => {
    bench('5 regions', () => {
        const extraction = PhpBridgeRegions.extract(TEMPLATE_5_REGIONS);
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, extraction);
    });

    bench('10 regions', () => {
        const extraction = PhpBridgeRegions.extract(TEMPLATE_10_REGIONS);
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, extraction);
    });

    bench('20 regions', () => {
        const extraction = PhpBridgeRegions.extract(TEMPLATE_20_REGIONS);
        PhpBridgeShadowDocument.build(WORKSPACE_ROOT, BLADE_URI, extraction);
    });
});
