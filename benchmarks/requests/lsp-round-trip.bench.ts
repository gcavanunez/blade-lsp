/**
 * Request-level benchmarks for LSP round-trips.
 *
 * Measures the end-to-end latency of completion, hover, and definition
 * requests through the full in-memory LSP pipeline. Uses the same
 * TestStream transport as integration tests — no real PHP backend,
 * so this isolates the blade-lsp overhead itself.
 *
 * These benchmarks are async (each iteration awaits the LSP response).
 * They're slower than microbenchmarks but more representative of real usage.
 */

import { bench, describe, beforeAll, afterAll } from 'vitest';
import { createClient, type Client, type ClientDocument } from '../../tests/utils/client';
import { SMALL_TEMPLATE, MEDIUM_TEMPLATE, LARGE_TEMPLATE } from '../fixtures';

// ─── Shared client state ────────────────────────────────────────────────────

let client: Client;
let smallDoc: ClientDocument;
let mediumDoc: ClientDocument;
let largeDoc: ClientDocument;

beforeAll(async () => {
    client = await createClient({
        settings: {
            enableLaravelIntegration: false,
        },
    });

    smallDoc = await client.open({ text: SMALL_TEMPLATE, name: 'bench-small.blade.php' });
    mediumDoc = await client.open({ text: MEDIUM_TEMPLATE, name: 'bench-medium.blade.php' });
    largeDoc = await client.open({ text: LARGE_TEMPLATE, name: 'bench-large.blade.php' });
}, 30_000);

afterAll(async () => {
    await smallDoc?.close();
    await mediumDoc?.close();
    await largeDoc?.close();
    await client?.shutdown();
}, 10_000);

// ─── Completion benchmarks ──────────────────────────────────────────────────

describe('completion — directive (@)', () => {
    // Position at a line containing '@' (all templates have directive blocks)
    bench('100 lines', async () => {
        await smallDoc.completions(4, 1);
    });

    bench('500 lines', async () => {
        await mediumDoc.completions(4, 1);
    });

    bench('2000 lines', async () => {
        await largeDoc.completions(4, 1);
    });
});

describe('completion — echo expression ({{ $)', () => {
    // Position inside an echo expression
    // Line 1 in all templates: `@section('content')` or similar.
    // Line ~5 has `{{ $title }}` from the HTML_LINES fixture
    bench('100 lines', async () => {
        await smallDoc.completions(4, 40);
    });

    bench('500 lines', async () => {
        await mediumDoc.completions(4, 40);
    });

    bench('2000 lines', async () => {
        await largeDoc.completions(4, 40);
    });
});

// ─── Hover benchmarks ───────────────────────────────────────────────────────

describe('hover — directive', () => {
    // Hover over a line with a directive
    bench('100 lines', async () => {
        await smallDoc.hover(4, 2);
    });

    bench('500 lines', async () => {
        await mediumDoc.hover(4, 2);
    });

    bench('2000 lines', async () => {
        await largeDoc.hover(4, 2);
    });
});

describe('hover — HTML (no match)', () => {
    // Hover over plain HTML where no provider will match — measures
    // the "fast path" exit cost through all hover checks.
    bench('100 lines', async () => {
        await smallDoc.hover(0, 5);
    });

    bench('500 lines', async () => {
        await mediumDoc.hover(0, 5);
    });

    bench('2000 lines', async () => {
        await largeDoc.hover(0, 5);
    });
});

// ─── Definition benchmarks ──────────────────────────────────────────────────

describe('definition — no match (fast exit)', () => {
    // Position on plain HTML where no definition exists
    bench('100 lines', async () => {
        await smallDoc.definition(0, 5);
    });

    bench('500 lines', async () => {
        await mediumDoc.definition(0, 5);
    });

    bench('2000 lines', async () => {
        await largeDoc.definition(0, 5);
    });
});

// ─── Document symbols benchmarks ────────────────────────────────────────────

describe('document symbols', () => {
    bench('100 lines', async () => {
        await smallDoc.symbols();
    });

    bench('500 lines', async () => {
        await mediumDoc.symbols();
    });

    bench('2000 lines', async () => {
        await largeDoc.symbols();
    });
});

// ─── Document links benchmarks ──────────────────────────────────────────────

describe('document links', () => {
    bench('100 lines', async () => {
        await smallDoc.links();
    });

    bench('500 lines', async () => {
        await mediumDoc.links();
    });

    bench('2000 lines', async () => {
        await largeDoc.links();
    });
});
