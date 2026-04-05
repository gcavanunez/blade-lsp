# Performance: Repeated `source.split('\n')` calls

## Summary

20 call sites across 13 files split source text into lines via `source.split('\n')`. While each LSP handler only splits once per request, large Blade templates (1000+ lines) will allocate a new string array on every request. A shared `Lines` utility or per-request cache could eliminate redundant allocations.

## Call sites

### server.ts (3 sites, same `source` variable but different handlers)

- `server.ts:470` — completions handler
- `server.ts:567` — definitions handler
- `server.ts:691` — code actions handler

### providers/ (11 sites)

- `completions.ts:565`
- `definitions.ts:153`
- `definitions.ts:235`
- `shared.ts:226`
- `shared.ts:296`
- `shared.ts:350`
- `php-preamble-symbols.ts:28`
- `php-preamble-symbols.ts:216`
- `document-symbols.ts:75`
- `document-links.ts:15`
- `code-actions.ts:278`

### providers/php-bridge/ (2 sites)

- `mapping.ts:18`
- `mapping.ts:24`

### parser/ (2 sites)

- `context.ts:159`
- `lexer.ts:334`

### diagnostics (2 sites)

- `diagnostics.ts:119`
- `diagnostics.ts:176`

## Possible fix

Cache split lines per document version in a lightweight utility:

```typescript
export namespace Lines {
    const cache = new WeakMap<object, string[]>();

    export function of(source: string): string[] {
        // Use the string's identity if interned, otherwise split fresh.
        // For a real cache, key on (uri, version) from the document.
        return source.split('\n');
    }
}
```

Or pass pre-split `lines` into provider functions that currently accept `source: string`, since several providers split the same source independently within a single hover/completion cycle.
