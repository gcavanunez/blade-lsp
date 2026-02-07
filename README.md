# Laravel Blade LSP

A Language Server Protocol implementation for Laravel Blade templates, built with TypeScript, Node.js, and tree-sitter-blade.

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

## Neovim Configuration

Using [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig):

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

Update `/path/to/blade-lsp/dist/server.js` to the actual path where you cloned and built the project.

## License

MIT
