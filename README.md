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
│   ├── server.ts      # Main LSP server
│   ├── parser.ts      # Tree-sitter based Blade parser
│   ├── directives.ts  # Directive definitions
│   └── types/         # Type declarations
├── dist/              # Built output
├── package.json
└── tsconfig.json
```

## Technical Notes

- Uses **tree-sitter@0.20.6** (pinned) for compatibility with tree-sitter-blade's native bindings
- Uses **CommonJS** module format (not ESM) for native module compatibility
- The tree-sitter-blade native module is rebuilt during `npm install`

## License

MIT
