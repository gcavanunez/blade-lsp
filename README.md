# Laravel Blade LSP

Built with TypeScript, Node.js, and tree-sitter-blade.

## Installation (Development)

```bash
# Clone the repository
git clone https://github.com/gcavanunez/blade-lsp.git
cd blade-lsp

# Install dependencies
npm install

# Build
npm run build
```

## Neovim Configuration

### Mason (Recommended)

Install via [Mason](https://github.com/williamboman/mason.nvim) using the [blade-lsp-mason](https://github.com/gcavanunez/blade-lsp-mason) registry:

```lua
require("mason").setup({
  registries = {
    "github:gcavanunez/blade-lsp-mason",
    "github:mason-org/mason-registry",
  },
})
```

Run `:MasonUpdate` to refresh registries, then `:MasonInstall blade-lsp`.

Once installed, configure the LSP using `vim.lsp.config` (Neovim 0.11+):

```lua
vim.lsp.config('blade_lsp', {
  cmd = { 'blade-lsp', '--stdio' },
  filetypes = { 'blade' },
  root_markers = { 'composer.json', 'artisan', '.git' },
})
```

### Manual

If you prefer not to use Mason, clone and build the project, then point directly to the built server:

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

    -- boolean|nil (default: false)
    -- Enables the embedded PHP bridge for `<?php ... ?>` and `@php ... @endphp`
    -- regions inside Blade files.
    enableEmbeddedPhpBridge = false,

    -- "intelephense"|"phpactor"|nil (default: "intelephense")
    -- Selects the downstream PHP backend used by the embedded bridge.
    embeddedPhpBackend = 'phpactor',

    -- string[]|nil (default: backend-specific command)
    -- Explicit command array for the embedded PHP backend.
    embeddedPhpLspCommand = { '/home/you/.local/share/nvim/mason/bin/phpactor', 'language-server' },

    -- Backend-specific bridge configuration.
    intelephense = {
      initializationOptions = {
        globalStoragePath = vim.fn.expand('~/.local/share/intelephense'),
        storagePath = vim.fn.expand('~/.local/share/intelephense'),
      },
      settings = {
        intelephense = {
          client = {
            autoCloseDocCommentDoSuggest = true,
          },
          files = {
            maxSize = 10000000,
          },
        },
      },
    },

    phpactor = {
      initializationOptions = {
        ['language_server_phpstan.enabled'] = false,
        ['language_server_psalm.enabled'] = false,
      },
    },
  },
})
```

### Embedded PHP Bridge Notes

- The embedded PHP bridge currently works best with **`phpactor`** as the downstream backend.
- `phpactor` is the recommended backend today for practical class completion/import flows such as:
    - `User` -> `User (App)` -> `use App\Models\User;`
- `intelephense` support remains available, but is currently more experimental/weaker in this embedded bridge mode.
- The currently supported happy path is bare class completion in Blade PHP regions; namespaced completion forms like `\App\Models\U` are still being explored.

## Credits

This project draws inspiration from and utilities from:

- [elm-language-server](https://github.com/elm-tooling/elm-language-server)
- [tailwindcss-intellisense](https://github.com/tailwindlabs/tailwindcss-intellisense)
- [laravel.nvim](https://github.com/adalessa/laravel.nvim)
- [laravel/vs-code-extension](https://github.com/laravel/vs-code-extension)
- [tree-sitter-blade](https://github.com/EmranMR/tree-sitter-blade)

## License

MIT
