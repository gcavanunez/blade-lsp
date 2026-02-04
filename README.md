# Laravel Blade LSP

A Language Server Protocol implementation for Laravel Blade templates, built with TypeScript, Node.js, and tree-sitter-blade.

## Features

- **Tree-sitter Parsing**: Uses [tree-sitter-blade](https://github.com/EmranMR/tree-sitter-blade) for accurate AST parsing
- **Directive Completion**: Auto-complete all Blade directives (`@if`, `@foreach`, `@extends`, etc.)
- **Laravel Helper Completion**: Suggestions for Laravel helpers in echo statements (`route()`, `asset()`, `config()`, etc.)
- **Context-Aware Parameters**: Smart completions for directive parameters (layouts, sections, permissions, etc.)
- **Hover Documentation**: Detailed documentation for Blade directives and special variables
- **Diagnostics**: Syntax error detection via tree-sitter
- **Special Variables**: Documentation for `$loop`, `$slot`, `$attributes`

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/blade-lsp.git
cd blade-lsp

# Install dependencies (includes native tree-sitter build)
npm install

# Build
npm run build
```

## Usage

### Running the LSP Server

```bash
# Development mode (with tsx)
npm run dev

# Production (after build)
npm run start
# or
node dist/server.js --stdio
```

### Editor Configuration

#### Neovim (with nvim-lspconfig)

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.blade_lsp then
  configs.blade_lsp = {
    default_config = {
      cmd = { 'node', '/path/to/blade-lsp/dist/server.js', '--stdio' },
      filetypes = { 'blade' },
      root_dir = lspconfig.util.root_pattern('composer.json', '.git'),
      settings = {},
    },
  }
end

lspconfig.blade_lsp.setup({})
```

#### VS Code

Create a VS Code extension or use a generic LSP client extension:

```json
{
  "languageServerExample.serverCommand": "node",
  "languageServerExample.serverArgs": ["/path/to/blade-lsp/dist/server.js", "--stdio"]
}
```

#### Helix

Add to `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "blade"
scope = "source.blade.php"
file-types = ["blade.php"]
language-servers = ["blade-lsp"]

[language-server.blade-lsp]
command = "node"
args = ["/path/to/blade-lsp/dist/server.js", "--stdio"]
```

## Supported Directives

### Control Structures
- `@if`, `@elseif`, `@else`, `@endif`
- `@unless`, `@endunless`
- `@isset`, `@endisset`
- `@empty`, `@endempty`
- `@switch`, `@case`, `@default`, `@endswitch`

### Loops
- `@for`, `@endfor`
- `@foreach`, `@endforeach`
- `@forelse`, `@empty`, `@endforelse`
- `@while`, `@endwhile`
- `@continue`, `@break`

### Template Inheritance
- `@extends`, `@section`, `@endsection`
- `@yield`, `@parent`, `@show`

### Components
- `@component`, `@endcomponent`
- `@slot`, `@endslot`
- `@props`

### Includes
- `@include`, `@includeIf`, `@includeWhen`
- `@includeUnless`, `@includeFirst`
- `@each`

### Stacks
- `@stack`, `@push`, `@endpush`
- `@prepend`, `@endprepend`

### Authorization
- `@auth`, `@endauth`
- `@guest`, `@endguest`
- `@can`, `@cannot`, `@canany`

### Forms
- `@csrf`, `@method`
- `@error`, `@enderror`

### Environment
- `@env`, `@endenv`
- `@production`, `@endproduction`

### And many more...

## Development

```bash
# Run type checking
npm run typecheck

# Build for distribution
npm run build

# Run in development mode
npm run dev
```

## Project Structure

```
blade-lsp/
├── src/
│   ├── server.ts          # LSP server + Completions, Hovers, Definitions namespaces
│   ├── parser.ts          # Tree-sitter Blade parser
│   ├── directives.ts      # Built-in directive definitions
│   ├── laravel/           # Laravel project integration
│   │   ├── index.ts       # Laravel namespace (main entry)
│   │   ├── context.ts     # LaravelContext namespace (state management)
│   │   ├── project.ts     # Project detection & validation
│   │   ├── php-runner.ts  # PhpRunner namespace (PHP script execution)
│   │   ├── views.ts       # Views namespace
│   │   ├── components.ts  # Components namespace
│   │   ├── directives.ts  # Directives namespace (custom directives)
│   │   └── types.ts       # Shared types
│   ├── utils/             # Standalone utilities
│   │   ├── context.ts     # Context.create() - AsyncLocalStorage wrapper
│   │   ├── error.ts       # NamedError.create() - Typed errors with Zod
│   │   ├── format-error.ts# FormatError() - User-facing error messages
│   │   ├── log.ts         # Log.create() - Structured logging
│   │   ├── lock.ts        # Lock.read/write() - Async read/write locks
│   │   ├── defer.ts       # defer() - Cleanup with using/Symbol.dispose
│   │   ├── retry.ts       # retry() - Exponential backoff
│   │   └── lazy.ts        # lazy() - Lazy evaluation
│   └── types/             # Type declarations
├── scripts/               # PHP scripts for Laravel extraction
│   ├── bootstrap-laravel.php
│   ├── extract-views.php
│   ├── extract-components.php
│   └── extract-directives.php
├── dist/                  # Built output
└── vs-code-extension/     # VS Code client extension
```

## Architecture

This LSP follows patterns inspired by [opencode](https://github.com/anthropics/opencode), using **export namespaces** instead of classes for module organization.

### Namespace Module Pattern

Each module exports a namespace containing related functions, types, and errors:

```typescript
// Instead of classes with singletons
export namespace Views {
  // Errors (Zod-validated, typed)
  export const RefreshError = NamedError.create('ViewsRefreshError', z.object({ ... }));
  export const NotFoundError = NamedError.create('ViewsNotFoundError', z.object({ ... }));

  // Functions (not methods)
  export async function refresh(): Promise<void> { ... }
  export function find(key: string): ViewItem | undefined { ... }
  export function get(key: string): ViewItem { ... } // throws NotFoundError
}

// Usage
await Views.refresh();
const view = Views.find('layouts.app');
```

### Error Handling

Errors are defined using `NamedError.create()` with Zod schemas for type-safe error data:

```typescript
// Definition (inside namespace)
export const TimeoutError = NamedError.create(
  'PhpRunnerTimeoutError',
  z.object({
    timeoutMs: z.number(),
    scriptName: z.string(),
  })
);

// Throwing
throw new PhpRunner.TimeoutError({ timeoutMs: 30000, scriptName: 'extract-views' });

// Catching (type-safe)
if (PhpRunner.TimeoutError.isInstance(error)) {
  console.log(error.data.scriptName); // Type-safe access
}

// User-facing formatting
const message = FormatError(error); // "PHP script 'extract-views' timed out after 30000ms"
```

### Context & State Management

Global state is managed via `LaravelContext` using AsyncLocalStorage with a global fallback:

```typescript
// Set during initialization
LaravelContext.setGlobal(state);

// Access anywhere (throws if not available)
const state = LaravelContext.use();
const views = state.views.items;

// Check availability
if (LaravelContext.isAvailable()) { ... }
```

### Concurrency Control

Async operations use `Lock` for mutual exclusion:

```typescript
export async function refresh(): Promise<void> {
  using _ = await Lock.write('views-refresh');
  // Only one refresh can run at a time
  // Lock automatically released when scope exits
}
```

### Utility Patterns

| Utility | Purpose | Example |
|---------|---------|---------|
| `Lock.write(key)` | Exclusive async lock | `using _ = await Lock.write('refresh')` |
| `Log.create(tags)` | Structured logging | `log.info('msg', { key: 'value' })` |
| `Log.time(msg)` | Timing with auto-log | `using _ = log.time('operation')` |
| `defer(fn)` | Cleanup on scope exit | `using _ = defer(() => cleanup())` |
| `retry(fn, opts)` | Exponential backoff | `retry(() => fetch(), { attempts: 3 })` |
| `lazy(fn)` | Lazy evaluation | `const value = lazy(() => expensive())` |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         LSP Server                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Completions  │  │    Hovers    │  │    Definitions       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────────────┼──────────────────────┘               │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Laravel Namespace                        │  │
│  │  ┌─────────┐  ┌────────────┐  ┌────────────┐               │  │
│  │  │  Views  │  │ Components │  │ Directives │               │  │
│  │  └────┬────┘  └─────┬──────┘  └─────┬──────┘               │  │
│  │       │             │               │                       │  │
│  │       └─────────────┼───────────────┘                       │  │
│  │                     │                                       │  │
│  │                     ▼                                       │  │
│  │            ┌─────────────────┐                              │  │
│  │            │  LaravelContext │ (global state)               │  │
│  │            └────────┬────────┘                              │  │
│  │                     │                                       │  │
│  │                     ▼                                       │  │
│  │            ┌─────────────────┐                              │  │
│  │            │   PhpRunner     │ (executes PHP scripts)       │  │
│  │            └────────┬────────┘                              │  │
│  └─────────────────────┼──────────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Laravel Project     │
              │  (vendor/blade-lsp/)  │
              │                       │
              │  PHP scripts execute  │
              │  in Laravel context   │
              └───────────────────────┘
```

### PHP Script Execution

The LSP extracts data from Laravel by:

1. Writing combined PHP scripts to `vendor/blade-lsp/`
2. Executing via configured PHP command (local, Docker, Sail)
3. Parsing JSON output between markers
4. Caching results in `LaravelContext`

```typescript
// Scripts are cached by content hash
const data = await PhpRunner.runScript<ViewItem[]>({
  project: state.project,
  scriptName: 'extract-views',
  timeout: 30000,
  retry: { attempts: 2, delay: 1000 },
});
```

## Technical Notes

- Uses **tree-sitter@0.20.6** (pinned) for compatibility with tree-sitter-blade's native bindings
- Uses **CommonJS** module format (not ESM) for native module compatibility
- The tree-sitter-blade native module is rebuilt during `npm install`

## License

MIT
