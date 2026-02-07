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

Using the built-in `vim.lsp.config` (Neovim 0.11+):

```lua
vim.lsp.config('blade_lsp', {
  cmd = { 'node', '/path/to/blade-lsp/dist/server.js', '--stdio' },
  filetypes = { 'blade' },
  root_markers = { 'composer.json', 'artisan', '.git' },
})
```

Update `/path/to/blade-lsp/dist/server.js` to the actual path where you cloned and built the project.

### Initialization Options

You can pass `init_options` to configure the LSP server's behavior:

```lua
vim.lsp.config('blade_lsp', {
  cmd = { 'node', '/path/to/blade-lsp/dist/server.js', '--stdio' },
  filetypes = { 'blade' },
  root_markers = { 'composer.json', 'artisan', '.git' },
  init_options = {
    -- string[]|nil (default: auto-detected)
    -- Explicit command array to execute PHP. When omitted, the server
    -- auto-detects by probing: Herd, Valet, Sail, Lando, DDEV, Local, Docker.
    phpCommand = { 'docker', 'compose', 'exec', '-T', 'app', 'php' },

    -- "herd"|"valet"|"sail"|"lando"|"ddev"|"local"|"docker"|nil (default: auto-detected)
    -- Preferred PHP environment. When set, skips auto-detection and
    -- tries only the specified environment.
    phpEnvironment = 'docker',

    -- boolean|nil (default: true)
    -- Enables Laravel project integration (views, components, custom directives
    -- via PHP). Set to false for standalone Blade support only.
    enableLaravelIntegration = true,
  },
})
```

## Credits

This project draws inspiration from and utilities from:

- [elm-language-server](https://github.com/elm-tooling/elm-language-server)
- [tailwindcss-intellisense](https://github.com/tailwindlabs/tailwindcss-intellisense)
- [laravel.nvim](https://github.com/adalessa/laravel.nvim)
- [laravel/vs-code-extension](https://github.com/laravel/vs-code-extension)
- [tree-sitter-blade](https://github.com/EmranMR/tree-sitter-blade)

## License

MIT
