# Blade LSP Improvements Plan

Incremental PRs, each stacked from the latest branch (`gc/jigsaw-e2e-and-testing-docs` at `f4da7ee`).

Informed by studying Vue/Volar's virtual document architecture, Tailwind CSS Intellisense, elm-language-server, and the official Laravel VS Code extension.

---

## Architecture context

### PHP bridge process model

The bridge spawns **one PHP LSP child process per workspace** (not per file). All shadow documents are opened on the same backend via `textDocument/didOpen` / `textDocument/didChange` over stdio JSON-RPC. The singleton is enforced by a 4-state machine in `backend.ts` (`idle -> starting -> running -> stopping`) and mirrored by `BackendLifecycle` in `bridge.ts`. Concurrent callers share the same startup promise.

Version tracking uses a **global monotonic counter** (`shadowVersion`) shared across all shadow documents, not per-document versions. Each sync bumps the counter and passes it to the backend. The store tracks `backendSyncedVersion` per blade URI to know whether a re-sync is needed.

### Current performance testing

**None exists.** No benchmarks, no latency measurements, no regression detection. The logger has a `time()` utility (`src/utils/log.ts:175`) but it is only used for operational logging. Vitest is configured for tests only (`vitest run`), not bench mode.

---

## PR 0 — Benchmark infrastructure (baseline measurements)

**Branch:** `gc/benchmarks`
**Stacks on:** `gc/jigsaw-e2e-and-testing-docs`

### Rationale

We need baseline numbers _before_ the performance PRs so we can measure the actual delta. Without a before/after comparison, we are guessing at impact.

### Setup

Add `vitest bench` support. Vitest already supports benchmarking natively — it uses `tinybench` under the hood and outputs min/max/p75/p99 with statistical significance. No extra dependencies needed.

Add a script to `package.json`:

```json
"bench": "vitest bench"
```

Create a `benchmarks/` directory at the project root (parallel to `tests/`).

### Microbenchmarks (`benchmarks/micro/`)

Isolated function-level timing. These run in milliseconds, no LSP setup needed.

**`line-splitting.bench.ts`** — Baseline for the split problem:

```typescript
import { bench, describe } from 'vitest';

// Generate realistic Blade templates at various sizes
const small = generateBladeTemplate(100); // 100 lines
const medium = generateBladeTemplate(500); // 500 lines
const large = generateBladeTemplate(2000); // 2000 lines

describe('line splitting', () => {
    bench('split(\\n) — 100 lines', () => {
        small.split('\n');
    });
    bench('split(\\n) — 500 lines', () => {
        medium.split('\n');
    });
    bench('split(\\n) — 2000 lines', () => {
        large.split('\n');
    });
});
```

After PR 1, add `LineIndex` benchmarks to the same file for direct comparison.

**`offset-position.bench.ts`** — Baseline for mapping hot path:

```typescript
describe('offsetToPosition', () => {
    bench('split-based (current) — 500 lines', () => {
        PhpBridgeMapping.offsetToPosition(medium, randomOffset);
    });
});

describe('positionToOffset', () => {
    bench('split-based (current) — 500 lines', () => {
        PhpBridgeMapping.positionToOffset(medium, randomPosition);
    });
});
```

After PR 1, add `LineIndex`-based variants for comparison.

**`region-lookup.bench.ts`** — Baseline for region search:

```typescript
describe('region lookup', () => {
    bench('linear find — 5 regions', () => {
        regions5.find((r) => offset >= r.bladeContentOffsetStart && offset <= r.bladeContentOffsetEnd);
    });
    bench('linear find — 20 regions', () => {
        regions20.find((r) => offset >= r.bladeContentOffsetStart && offset <= r.bladeContentOffsetEnd);
    });
});
```

After PR 2, add binary search variants.

**`shadow-build.bench.ts`** — Baseline for shadow document construction:

```typescript
describe('shadow document build', () => {
    bench('full build — 5 regions', () => {
        PhpBridgeShadowDocument.build(root, uri, extraction5);
    });
    bench('full build — 20 regions', () => {
        PhpBridgeShadowDocument.build(root, uri, extraction20);
    });
});
```

After PR 6, add incremental update variants.

### Request-level benchmarks (`benchmarks/requests/`)

Full LSP round-trip through the in-memory `TestStream` transport with fake PHP backends. Measures the overhead of the blade-lsp pipeline itself (parsing, region extraction, mapping, provider logic) — excluding real PHP backend latency.

**`completion.bench.ts`**:

```typescript
describe('completion round-trip', () => {
    bench('blade directive — 500 line file', async () => {
        await client.completions(position);
    });
    bench('php region — 500 line file (bridge path)', async () => {
        await client.completions(phpPosition);
    });
});
```

**`hover.bench.ts`**, **`definition.bench.ts`** — Same pattern.

### Test data generation

Create a `benchmarks/fixtures.ts` that generates realistic Blade templates:

```typescript
export function generateBladeTemplate(lineCount: number): string {
    // Mix of HTML, Blade directives, @php blocks, component tags,
    // {{ $var }} expressions — representative of real-world files
}

export function generateExtractionWithRegions(regionCount: number): RegionExtraction {
    // Generate a source with N PHP regions spread throughout
}
```

### What we measure

| Benchmark                               | What it tells us             | Affected by PRs                      |
| --------------------------------------- | ---------------------------- | ------------------------------------ |
| `split('\n')` at various sizes          | Cost of the current approach | PR 1 eliminates it                   |
| `offsetToPosition` / `positionToOffset` | Per-call mapping cost        | PR 1 (LineIndex), PR 2 (offset-only) |
| Region lookup at various counts         | Linear vs binary search      | PR 2                                 |
| Shadow document build                   | Full rebuild cost            | PR 6 (incremental)                   |
| Completion round-trip                   | End-to-end pipeline overhead | PR 1 + PR 2 combined                 |
| Hover/definition round-trip             | End-to-end pipeline overhead | PR 1 + PR 2 combined                 |

### Running

```bash
# Run all benchmarks
pnpm bench

# Run only microbenchmarks
pnpm vitest bench benchmarks/micro

# Run only request benchmarks
pnpm vitest bench benchmarks/requests
```

Local only for now. CI gating can be added later once we have stable baselines and know what thresholds are reasonable.

---

## PR 1 — LineIndex: eliminate `split('\n')` allocations

**Branch:** `gc/line-index`
**Stacks on:** `gc/jigsaw-e2e-and-testing-docs`

### Problem

20 call sites across 13 files do `source.split('\n')`, each allocating a full `string[]`. In the PHP bridge's `mapping.ts`, this happens per-position-mapping — a single completion response with 100 items triggers ~400 splits on the same two strings. For a 1000-line Blade file that is ~400 array allocations of 1000 elements each, per keystroke.

### Design

Create a `LineIndex` class and attach it to `LexedSource`. The lexer already computes `lines: string[]` in `lexSource()` (`parser/lexer.ts:334`). Replace that with a `LineIndex` that scans the source once O(n) and does O(log n) binary-search lookups.

```typescript
// src/utils/line-index.ts
export class LineIndex {
    /** Byte offset where each line starts. lineStarts[0] is always 0. */
    private readonly lineStarts: Uint32Array;
    readonly lineCount: number;
    readonly source: string;

    constructor(source: string) {
        this.source = source;
        const starts: number[] = [0];
        for (let i = 0; i < source.length; i++) {
            if (source.charCodeAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        this.lineStarts = new Uint32Array(starts);
        this.lineCount = starts.length;
    }

    /** O(log n) — binary search for the line containing `offset`. */
    offsetToPosition(offset: number): Position {
        const clamped = Math.max(0, Math.min(offset, this.source.length));
        let lo = 0;
        let hi = this.lineCount - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.lineStarts[mid] <= clamped) lo = mid;
            else hi = mid - 1;
        }
        return { line: lo, character: clamped - this.lineStarts[lo] };
    }

    /** O(1) — direct lookup. */
    positionToOffset(position: Position): number {
        const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
        return this.lineStarts[line] + position.character;
    }

    /** Returns the text of a single line (without trailing newline). */
    getLineText(line: number): string {
        if (line < 0 || line >= this.lineCount) return '';
        const start = this.lineStarts[line];
        const end = line + 1 < this.lineCount ? this.lineStarts[line + 1] - 1 : this.source.length;
        return this.source.slice(start, end);
    }

    /** Returns [startOffset, endOffset) for a line. */
    getLineRange(line: number): [number, number] {
        const start = this.lineStarts[line] ?? 0;
        const end = line + 1 < this.lineCount ? this.lineStarts[line + 1] - 1 : this.source.length;
        return [start, end];
    }
}
```

### Integration into LexedSource

```typescript
// parser/lexer.ts
export interface LexedSource {
    lineIndex: LineIndex; // replaces `lines: string[]`
    directiveTokens: DirectiveToken[];
    phpRanges: OffsetRange[];
}

export function lexSource(source: string): LexedSource {
    const { directiveTokens, phpRanges } = scan(source);
    return {
        lineIndex: new LineIndex(source),
        directiveTokens,
        phpRanges,
    };
}
```

Any code that currently reads `lexed.lines[n]` switches to `lexed.lineIndex.getLineText(n)`. Any code that does `source.split('\n')` and then indexes into the result switches to `lineIndex.getLineText(line)`.

### Call sites to migrate (20 total)

| File                      | Line | Current usage                       | Migration                                                |
| ------------------------- | ---- | ----------------------------------- | -------------------------------------------------------- |
| `server.ts`               | 470  | `source.split('\n')[position.line]` | `lineIndex.getLineText(position.line)`                   |
| `server.ts`               | 567  | `source.split('\n')[position.line]` | `lineIndex.getLineText(position.line)`                   |
| `server.ts`               | 691  | `source.split('\n')`                | `lineIndex.getLineText(line)`                            |
| `completions.ts`          | 565  | `content.split('\n')`               | Build a local `LineIndex` for the component file content |
| `definitions.ts`          | 153  | `content.split('\n')`               | Build a local `LineIndex` for the target file content    |
| `definitions.ts`          | 235  | `content.split('\n')`               | Build a local `LineIndex` for the target file content    |
| `shared.ts`               | 226  | `source.split('\n')`                | Accept `LineIndex` parameter                             |
| `shared.ts`               | 296  | `source.split('\n')`                | Accept `LineIndex` parameter                             |
| `shared.ts`               | 350  | `source.split('\n')`                | Accept `LineIndex` parameter                             |
| `php-preamble-symbols.ts` | 28   | `before.split('\n')`                | `new LineIndex(before)` or accept parent `LineIndex`     |
| `php-preamble-symbols.ts` | 216  | `text.split('\n')`                  | `new LineIndex(text)`                                    |
| `document-symbols.ts`     | 75   | `source.split('\n')`                | Accept `LineIndex` from caller                           |
| `document-links.ts`       | 15   | `source.split('\n')`                | Accept `LineIndex` from caller                           |
| `code-actions.ts`         | 278  | `document.getText().split('\n')`    | Accept `LineIndex` from caller                           |
| `diagnostics.ts`          | 119  | `maskedSource.split('\n')`          | `new LineIndex(maskedSource)`                            |
| `diagnostics.ts`          | 176  | `maskedSource.split('\n')`          | Reuse same `LineIndex` from line 119                     |
| `mapping.ts`              | 18   | `before.split('\n')`                | Use `LineIndex.offsetToPosition()`                       |
| `mapping.ts`              | 24   | `source.split('\n')`                | Use `LineIndex.positionToOffset()`                       |
| `context.ts`              | 159  | `source.split('\n')`                | Accept `LineIndex` from caller                           |
| `lexer.ts`                | 334  | `source.split('\n')`                | Replaced by `LineIndex` constructor                      |

### Strategy for server.ts handlers

The server handlers (`completions`, `definitions`, `hover`, `codeActions`) each retrieve `document.getText()` and then call into providers. The plan is:

1. Build `LineIndex` once at the top of each handler from the document source.
2. Thread it as a parameter into provider functions that need line access.
3. For providers that operate on _other_ files (component file content, definition targets), they build their own local `LineIndex` — these are cold paths, not the hot per-keystroke loop.

### Tests

- Unit tests for `LineIndex`: round-trip `offset -> position -> offset` for edge cases (empty string, single line, trailing newline, no trailing newline, offset at newline boundary, offset past end).
- Integration tests: verify that completions, hover, definition, and diagnostics produce identical results before and after the migration. The existing test suite covers this — run the full suite and confirm no regressions.

### Backward compatibility for `lines: string[]`

If any external code or tests reference `lexed.lines`, add a getter that lazily splits:

```typescript
get lines(): string[] {
    return this._lines ??= this.lineIndex.source.split('\n');
}
```

This preserves compatibility during migration and can be removed once all call sites are ported.

---

## PR 2 — Offset-only mapping internals for PHP bridge

**Branch:** `gc/offset-mapping`
**Stacks on:** `gc/line-index`

### Problem

`mapping.ts` converts `Position -> offset -> offset -> Position` on every call, using `split('\n')` for each conversion. Even with `LineIndex` from PR 1, the design forces unnecessary Position/offset round-trips.

### Design

Refactor the mapping layer to work in offsets internally, deferring Position conversion to the call site. This mirrors Vue/Volar's architecture where all `Mapping` objects store `sourceOffsets`/`generatedOffsets`/`lengths` — never line/column.

```typescript
// New offset-based core functions
export function bladeOffsetToShadowOffset(
    shadow: ShadowDocument,
    bladeOffset: number,
): { kind: 'mapped'; offset: number; regionId: string } | { kind: 'unmappable' } {
    const region = findRegionByBladeOffset(shadow.regions, bladeOffset);
    if (!region) return { kind: 'unmappable' };
    return {
        kind: 'mapped',
        regionId: region.id,
        offset: region.shadowContentOffsetStart + (bladeOffset - region.bladeContentOffsetStart),
    };
}

export function shadowOffsetToBladeOffset(
    shadow: ShadowDocument,
    shadowOffset: number,
): { kind: 'mapped'; offset: number; regionId: string } | { kind: 'synthetic' | 'unmappable' } {
    const region = findRegionByShadowOffset(shadow.regions, shadowOffset);
    if (region) {
        return {
            kind: 'mapped',
            regionId: region.id,
            offset: region.bladeContentOffsetStart + (shadowOffset - region.shadowContentOffsetStart),
        };
    }
    const maxShadow = shadow.regions.reduce((m, r) => Math.max(m, r.shadowContentOffsetEnd), 0);
    return { kind: shadowOffset <= maxShadow ? 'synthetic' : 'unmappable' };
}
```

The existing Position-based functions become thin wrappers that call the offset core + `LineIndex` conversion. Call sites that only need offsets (like region detection in `bridge.ts`) skip the Position layer entirely.

### Binary search for region lookup

Replace the linear `.find()` with binary search. Regions are guaranteed sorted by offset (natural file order from extraction):

```typescript
function findRegionByBladeOffset(regions: ShadowRegion[], offset: number): ShadowRegion | undefined {
    let lo = 0;
    let hi = regions.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = regions[mid];
        if (offset < r.bladeContentOffsetStart) hi = mid - 1;
        else if (offset > r.bladeContentOffsetEnd) lo = mid + 1;
        else return r;
    }
    return undefined;
}
```

### Cache LineIndex in ShadowDocument

```typescript
export interface ShadowDocument {
    // ... existing fields
    lineIndex: LineIndex; // pre-built for shadow content
}
```

Built once in `PhpBridgeShadowDocument.build()`. The blade source `LineIndex` comes from `LexedSource.lineIndex` (available via the extraction).

### Cache LineIndex in BridgeDocumentState

```typescript
export interface BridgeDocumentState {
    // ... existing fields
    bladeLineIndex: LineIndex; // from extraction.lexed.lineIndex
}
```

This means the hot path in `bridge.ts` (`getCompletion`, `getDefinition`, etc.) does zero string splitting — it grabs pre-built `LineIndex` objects from the store.

### Tests

- Unit tests for offset-based mapping functions (same test matrix as Position-based, just in offset space).
- Verify the Position-based wrappers produce identical results to the old implementation.
- Run the full integration/e2e suite.

---

## PR 3 — Feature flags per PHP region

**Branch:** `gc/region-features`
**Stacks on:** `gc/offset-mapping`

### Problem

All PHP regions are currently treated identically. But an inline `@php($x = 1)` expression has different semantics than a full `@php ... @endphp` block or a Volt class definition. Backend diagnostics on synthetic wrapper functions would produce noise.

### Design

Inspired by Vue/Volar's `CodeInformation` pattern (`packages/language-core/lib/codegen/codeFeatures.ts`), attach feature flags to each region:

```typescript
export interface RegionFeatures {
    completion: boolean;
    hover: boolean;
    diagnostics: boolean;
    definition: boolean;
    references: boolean;
    rename: boolean;
}

export interface ShadowRegion {
    // ... existing fields
    features: RegionFeatures;
}
```

### Feature assignment rules

| Region kind                                          | Context               | Features                                                                                   |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `php-tag` (multi-line `<?php ... ?>`)                | Full PHP block        | All enabled                                                                                |
| `blade-directive` in `@php ... @endphp`              | Full directive block  | All enabled                                                                                |
| `blade-directive` inline `@php($expr)`               | Single expression     | completion, hover, definition only (no diagnostics — partial expressions confuse backends) |
| `blade-directive` in Volt class region               | Anonymous class body  | All enabled                                                                                |
| `blade-directive` wrapped in `__blade_lsp_scope_N()` | Post-Volt-class block | All except diagnostics (wrapper function would produce false errors)                       |

### Enforcement

Each proxy function in `bridge.ts` checks the region's features before forwarding:

```typescript
export async function getHover(state, document, position) {
    const entry = await syncDocument(state, document, position);
    const mapped = bladePositionToShadowPosition(...);
    if (mapped.kind !== 'mapped') return null;

    const region = entry.shadow.regions.find(r => r.id === mapped.regionId);
    if (!region?.features.hover) return null;  // feature gated

    // ... forward to backend
}
```

For diagnostics (PR 4), the filter happens on the response side — drop diagnostics whose range falls in a region with `diagnostics: false`.

### Detection logic

The region kind determination happens in `regions.ts:extract()`. To distinguish inline vs block `blade-directive` regions:

- **Inline:** Content does not contain a newline (`!content.includes('\n')`) and the raw source around the region starts with `@php(` (matched via lexer token context).
- **Block:** Everything else.

The Volt wrapper detection already exists in `shadow-document.ts` (`needsScope` flag). Thread that through to the `ShadowRegion`.

### Tests

- Unit tests asserting correct feature flags for each region type (inline php, block php, Volt class, scoped wrapper).
- Integration tests confirming hover/completion are blocked for disabled regions.

---

## PR 4 — Forward PHP diagnostics from backend

**Branch:** `gc/bridge-diagnostics`
**Stacks on:** `gc/region-features`

### Problem

The PHP bridge proxies hover, completion, and definition, but silently discards all diagnostics from the backend. PHP type errors, undefined variables, and import issues in `@php` blocks are invisible.

### Design

Subscribe to `textDocument/publishDiagnostics` notifications from the backend process. Remap diagnostic ranges from shadow to blade coordinates. Merge with existing blade diagnostics in the `DiagnosticStore` under a new `"php"` bucket.

### Implementation

**In `backend.ts`:** Register a notification handler for diagnostics:

```typescript
connection.onNotification('textDocument/publishDiagnostics', (params) => {
    diagnosticCallbacks.forEach(cb => cb(params));
});

// Expose on the Client interface:
onDiagnostics(callback: (params: PublishDiagnosticsParams) => void): void;
```

**In `bridge.ts`:** When the backend is ready, subscribe:

```typescript
backend.onDiagnostics((params) => {
    // Find which blade document this shadow URI belongs to
    const entry = findEntryByShadowUri(state.store, params.uri);
    if (!entry) return;

    const remapped = params.diagnostics.flatMap((diag) => {
        const mapped = shadowRangeToBladeRange(entry.source, entry.shadow, diag.range);
        if (mapped.kind !== 'mapped') return [];

        // Check feature flags
        const region = entry.shadow.regions.find((r) => r.id === mapped.regionId);
        if (!region?.features.diagnostics) return [];

        return [
            {
                ...diag,
                range: mapped.range,
                source: `php(${state.settings.embeddedPhpBackend ?? 'intelephense'})`,
            },
        ];
    });

    // Publish to the client via a callback or event
    publishDiagnostics(entry.bladeUri, 'php', remapped);
});
```

**In `diagnostic-store.ts`:** Add a `'php'` bucket alongside existing `'syntax'` and `'semantic'` buckets.

**Clearing stale diagnostics:** When a blade document is closed or when PHP content changes, clear the `'php'` bucket for that URI before the backend re-publishes.

### Edge cases

- Backend may publish diagnostics for the shadow `<?php` header or wrapper functions — these are synthetic regions and should be dropped (region lookup returns no match or `features.diagnostics === false`).
- Backend may publish diagnostics with `relatedInformation` pointing to shadow URIs — remap those too.
- Debounce: the backend may publish multiple times during indexing. The `DiagnosticStore`'s deep-equality check handles this.

### Tests

- Integration test: open a Blade file with a deliberate PHP error (e.g., undefined variable in `@php` block), verify a diagnostic is published under the blade URI.
- Integration test: verify diagnostics in inline `@php($expr)` regions are suppressed (feature flag).
- Integration test: verify diagnostics disappear when the PHP error is fixed.

---

## PR 5 — Forward references and rename from PHP backend

**Branch:** `gc/bridge-references-rename`
**Stacks on:** `gc/bridge-diagnostics`

### Problem

Users cannot find references to or rename PHP symbols from within Blade files. Both features follow the same mapping pattern already established for definition.

### References

```typescript
export async function getReferences(
    state: State,
    document: TextDocument,
    position: Position,
): Promise<Location[] | null> {
    const entry = await syncDocument(state, document, position);
    const mapped = bladePositionToShadowPosition(...);
    if (mapped.kind !== 'mapped') return null;

    const region = entry.shadow.regions.find(r => r.id === mapped.regionId);
    if (!region?.features.references) return null;

    const backend = await ensureBackend(state);
    if (!backend) return null;

    const result = await backend.references(entry.shadow.shadowUri, mapped.position);
    if (!result) return null;

    return result.flatMap(location => {
        if (location.uri !== entry.shadow.shadowUri) return [location]; // external file
        const remapped = shadowRangeToBladeRange(entry.source, entry.shadow, location.range);
        if (remapped.kind !== 'mapped') return [];
        return [{ uri: document.uri, range: remapped.range }];
    });
}
```

**In `backend.ts`:** Add a `references` method to the `Client` interface:

```typescript
references(uri: string, position: Position): Promise<Location[] | null>;
```

**In `server.ts`:** Register `definitionProvider` is already true. Add `referencesProvider: true` to capabilities and wire the handler.

### Rename

Rename is more complex because the backend returns a `WorkspaceEdit` with potentially many files.

```typescript
export async function prepareRename(state: State, document: TextDocument, position: Position): Promise<Range | null> {
    // Map position, call backend prepareRename, remap the returned range
}

export async function getRename(
    state: State,
    document: TextDocument,
    position: Position,
    newName: string,
): Promise<WorkspaceEdit | null> {
    // Map position, call backend rename, remap all edits:
    // - Shadow URI edits -> remap ranges to blade coordinates
    // - External file edits -> pass through unchanged
}
```

**In `server.ts`:** Add `renameProvider: { prepareProvider: true }` to capabilities.

### Tests

- Integration test: define a variable in `@php`, reference it in `{{ $var }}`, find-references returns both locations.
- Integration test: rename a class used in a `@php` block, verify the edit is correctly mapped.

---

## PR 6 — Incremental shadow document updates

**Branch:** `gc/incremental-shadow`
**Stacks on:** `gc/bridge-references-rename`

### Problem

Every keystroke triggers full region re-extraction + shadow rebuild + disk write. For a file with 15 PHP regions, this re-parses all regions even when only one character changed in one region.

### Design

Inspired by Vue/Volar's `updateSFC()` pattern. When a text change arrives:

1. **Classify the edit:** Does it fall entirely within one existing region?
2. **If yes (fast path):** Patch that region's content, shift subsequent region offsets by the length delta, update the shadow content with a splice, rebuild only the affected `ShadowRegion` entry.
3. **If no (slow path):** Fall back to full re-extraction (current behavior). This handles edits that cross region boundaries, create new regions, or delete regions.

### Implementation

```typescript
export function tryIncrementalUpdate(
    prevState: BridgeDocumentState,
    change: TextDocumentContentChangeEvent, // has range + text
    newSource: string,
): BridgeDocumentState | null {
    if (!('range' in change)) return null; // full-text change, can't be incremental

    const changeOffset = prevState.bladeLineIndex.positionToOffset(change.range.start);
    const changeEndOffset = prevState.bladeLineIndex.positionToOffset(change.range.end);
    const lengthDelta = change.text.length - (changeEndOffset - changeOffset);

    // Find the region containing the edit
    const hitRegion = prevState.extraction.regions.find(
        (r) => changeOffset >= r.contentOffsetStart && changeEndOffset <= r.contentOffsetEnd,
    );
    if (!hitRegion) return null; // crosses boundary or is between regions

    // Patch the region content
    const localStart = changeOffset - hitRegion.contentOffsetStart;
    const localEnd = changeEndOffset - hitRegion.contentOffsetStart;
    const newContent = hitRegion.content.slice(0, localStart) + change.text + hitRegion.content.slice(localEnd);

    // Clone and update regions
    const newRegions = prevState.extraction.regions.map((r) => {
        if (r.id === hitRegion.id) {
            return { ...r, content: newContent, contentOffsetEnd: r.contentOffsetEnd + lengthDelta };
        }
        if (r.contentOffsetStart > hitRegion.contentOffsetStart) {
            return {
                ...r,
                rawOffsetStart: r.rawOffsetStart + lengthDelta,
                rawOffsetEnd: r.rawOffsetEnd + lengthDelta,
                contentOffsetStart: r.contentOffsetStart + lengthDelta,
                contentOffsetEnd: r.contentOffsetEnd + lengthDelta,
            };
        }
        return r;
    });

    // Rebuild shadow with patched regions (avoids re-lexing)
    // ...
}
```

### Fallback guarantee

The incremental path returns `null` when it cannot handle an edit. The caller always falls back to full re-extraction. This means correctness is guaranteed — the incremental path is purely an optimization.

### Signature still checked

Even with incremental updates, the `signature` is recomputed from the patched regions. The `phpChanged` check in `store.apply()` still works correctly.

### Tests

- Unit test: edit inside a region, verify offsets are correctly shifted.
- Unit test: edit between regions, verify fallback to full extraction.
- Unit test: edit that deletes a region boundary, verify fallback.
- Integration test: type rapidly in a `@php` block, verify completions still work correctly.
- Benchmark: compare shadow rebuild time with/without incremental updates on a 50-region Blade file.

---

## PR order and dependencies

```
gc/jigsaw-e2e-and-testing-docs  (current HEAD)
  │
  ├── gc/benchmarks                    PR 0: Benchmark infrastructure + baseline measurements
  │     │
  │     └── gc/line-index              PR 1: LineIndex utility + LexedSource integration
  │           │                              (update benchmarks with LineIndex comparisons)
  │           │
  │           └── gc/offset-mapping    PR 2: Offset-only mapping + binary search + cached LineIndex
  │                 │                        (update benchmarks with offset + binary search comparisons)
  │                 │
  │                 └── gc/region-features        PR 3: Feature flags per region
  │                       │
  │                       └── gc/bridge-diagnostics        PR 4: Forward PHP diagnostics
  │                             │
  │                             └── gc/bridge-refs-rename   PR 5: Forward references + rename
  │                                   │
  │                                   └── gc/incremental-shadow  PR 6: Incremental shadow updates
  │                                                                (update benchmarks with incremental comparisons)
```

Each PR is independently shippable and testable. If any PR is delayed, subsequent PRs can still be developed against it locally and rebased when it merges.

### Benchmark update cadence

PRs 1, 2, and 6 each add comparison benchmarks alongside their implementation so we can measure the before/after delta in the same `vitest bench` run. PRs 3-5 are feature additions, not performance changes, so they don't require new benchmarks (but the existing request-level benchmarks still serve as regression guards).

---

## Out of scope (future work)

These came up during analysis but are not part of this plan:

- **Formatting provider** — delegate to blade-formatter or Pint
- **Folding ranges** — tree-sitter-blade already supports it, low effort
- **Workspace symbols** — search components/views across project
- **Signature help** — directive parameter hints
- **Route/config/translation completions** — major Laravel DX features
- **Service/server layer separation** — reusable logic split from LSP transport (Tailwind pattern)
- **Multi-project support** — monorepo handling
