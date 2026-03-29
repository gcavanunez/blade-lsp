# Testing

## Unit & Integration Tests

Unit and integration tests run in-process with an in-memory LSP transport (no PHP or external tooling required):

```bash
npm test              # run once
npm run test:watch    # watch mode
```

## E2E Tests

E2E tests create real framework projects in temp directories and exercise the full LSP pipeline including PHP script execution. Each suite is gated behind environment variables and skipped by default.

### Prerequisites

| Suite                       | Requires                                             |
| --------------------------- | ---------------------------------------------------- |
| Blade Components            | `laravel` CLI (or set `LARAVEL_INSTALLER_PATH`), PHP |
| Jigsaw                      | `composer` on `$PATH`, PHP                           |
| PHP Bridge Backend          | A PHP LSP binary (phpactor or intelephense)          |
| PHP Bridge Laravel Livewire | `laravel` CLI, PHP, a PHP LSP binary                 |

### Blade Component Completions (Flux & Livewire)

Scaffolds a Laravel project with fake Flux vendor components and nested Livewire components, then verifies `<flux:*>` and `<livewire:*>` completions.

```bash
BLADE_COMPONENT_RUN_E2E=true \
  npx vitest run tests/e2e/blade-component-completions.test.ts
```

| Variable                                    | Default          | Description                          |
| ------------------------------------------- | ---------------- | ------------------------------------ |
| `BLADE_COMPONENT_RUN_E2E`                   | _(unset = skip)_ | Set to `true` to enable              |
| `KEEP_BLADE_COMPONENT_E2E_APP`              | `false`          | Keep the temp project for inspection |
| `LARAVEL_INSTALLER_PATH`                    | `laravel`        | Path to the Laravel installer CLI    |
| `BLADE_COMPONENT_DISCOVERY_TIMEOUT_MS`      | `60000`          | Max wait for async PHP discovery     |
| `BLADE_COMPONENT_COMPLETION_RETRY_ATTEMPTS` | `20`             | Retry count for completion polling   |
| `BLADE_COMPONENT_COMPLETION_RETRY_DELAY_MS` | `1000`           | Delay between retries                |

### Jigsaw Project

Scaffolds a Jigsaw project with views, components, layouts, and partials in `source/`, then verifies completions, diagnostics, and go-to-definition.

```bash
JIGSAW_RUN_E2E=true \
  npx vitest run tests/e2e/jigsaw-completions.test.ts
```

| Variable                      | Default          | Description                                   |
| ----------------------------- | ---------------- | --------------------------------------------- |
| `JIGSAW_RUN_E2E`              | _(unset = skip)_ | Set to `true` to enable                       |
| `KEEP_JIGSAW_E2E_APP`         | `false`          | Keep the temp project for inspection          |
| `JIGSAW_DISCOVERY_TIMEOUT_MS` | `60000`          | Max wait for async PHP discovery              |
| `JIGSAW_RETRY_ATTEMPTS`       | `20`             | Retry count for completion/diagnostic polling |
| `JIGSAW_RETRY_DELAY_MS`       | `1000`           | Delay between retries                         |

### PHP Bridge Backend

Tests the embedded PHP bridge against a real phpactor or intelephense backend (no Laravel project required).

```bash
EMBEDDED_PHP_LSP_COMMAND_JSON='["/path/to/phpactor","language-server"]' \
EMBEDDED_PHP_LSP_BACKEND=phpactor \
  npx vitest run tests/e2e/php-bridge-backend.test.ts
```

| Variable                        | Default          | Description                                                                        |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `EMBEDDED_PHP_LSP_COMMAND_JSON` | _(unset = skip)_ | JSON string array of the backend command (e.g. `'["phpactor","language-server"]'`) |
| `EMBEDDED_PHP_LSP_BACKEND`      | `intelephense`   | Which backend: `phpactor` or `intelephense`                                        |

### PHP Bridge Laravel Livewire

Full end-to-end test: scaffolds a Laravel + Livewire project, starts the embedded PHP bridge, and verifies completions (e.g. `App\Models\User` with import edits, collection methods in `@php` blocks).

```bash
EMBEDDED_PHP_LSP_COMMAND_JSON='["/path/to/phpactor","language-server"]' \
EMBEDDED_PHP_LSP_BACKEND=phpactor \
EMBEDDED_PHP_BRIDGE_RUN_LARAVEL_E2E=true \
  npx vitest run tests/e2e/php-bridge-laravel-livewire.test.ts
```

| Variable                                        | Default          | Description                                                                                 |
| ----------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `EMBEDDED_PHP_LSP_COMMAND_JSON`                 | _(unset = skip)_ | JSON string array of the backend command                                                    |
| `EMBEDDED_PHP_LSP_BACKEND`                      | `intelephense`   | Which backend: `phpactor` or `intelephense`                                                 |
| `EMBEDDED_PHP_BRIDGE_RUN_LARAVEL_E2E`           | _(unset = skip)_ | Set to `true` to enable (both this AND `EMBEDDED_PHP_LSP_COMMAND_JSON` must be set)         |
| `KEEP_PHP_BRIDGE_E2E_APP`                       | `false`          | Keep the temp project for inspection                                                        |
| `LARAVEL_INSTALLER_PATH`                        | `laravel`        | Path to the Laravel installer CLI                                                           |
| `EMBEDDED_PHP_BRIDGE_COMPLETION_RETRY_ATTEMPTS` | `30`             | Retry count for completion polling                                                          |
| `EMBEDDED_PHP_BRIDGE_COMPLETION_RETRY_DELAY_MS` | `1000`           | Delay between retries                                                                       |
| `EMBEDDED_PHP_BRIDGE_NAMESPACE_RETRY_ATTEMPTS`  | `4`              | Retries for namespaced class completions                                                    |
| `EMBEDDED_PHP_BRIDGE_READY_TIMEOUT_MS`          | `180000`         | Max wait for backend indexer to finish (phpactor can take ~2 min on a full Laravel project) |

### Running All E2E Tests Locally

```bash
JIGSAW_RUN_E2E=true \
BLADE_COMPONENT_RUN_E2E=true \
EMBEDDED_PHP_LSP_COMMAND_JSON='["/path/to/phpactor","language-server"]' \
EMBEDDED_PHP_LSP_BACKEND=phpactor \
EMBEDDED_PHP_BRIDGE_RUN_LARAVEL_E2E=true \
  npm run test:e2e:php-bridge
```

### Installing PHP Language Servers Locally

The PHP bridge tests need a real PHP language server binary. Instead of relying on editor-specific tools like Mason, install them directly:

**phpactor** (recommended):

phpactor and `laravel/installer` have conflicting `symfony/console` version requirements, so they can't coexist in the global composer directory. Install phpactor into its own directory with `composer create-project`:

```bash
composer create-project phpactor/phpactor ~/.local/share/phpactor --stability=dev --no-interaction
```

Then use the full path:

```bash
EMBEDDED_PHP_LSP_COMMAND_JSON='["~/.local/share/phpactor/bin/phpactor","language-server"]'
```

**intelephense**:

```bash
npm install -g intelephense
```

Then use:

```bash
EMBEDDED_PHP_LSP_COMMAND_JSON='["intelephense","--stdio"]'
```

**Laravel CLI** (needed for blade-component and php-bridge-laravel-livewire tests):

```bash
composer global require laravel/installer
```

Make sure the global composer bin directory is on your PATH (`composer global config bin-dir --absolute`).

## CI

E2E tests run in a separate GitHub Actions workflow (`.github/workflows/e2e.yml`) on a weekly schedule and via manual dispatch. They are **not** part of the main CI pipeline to keep PR checks fast.

The workflow has three jobs:

| Job                | What it tests                                         | Backend matrix         |
| ------------------ | ----------------------------------------------------- | ---------------------- |
| `blade-components` | `<flux:*>` and `<livewire:*>` completions             | -                      |
| `jigsaw`           | Views, components, diagnostics, definitions in Jigsaw | -                      |
| `php-bridge`       | Embedded PHP bridge completions and definitions       | phpactor, intelephense |

PHP language servers are installed without Mason:

- **phpactor**: `composer create-project` into an isolated directory (conflicts with `laravel/installer` in global composer due to `symfony/console` version mismatch)
- **intelephense**: `npm install -g intelephense`
- **Laravel CLI**: `composer global require laravel/installer`

The workflow can be triggered manually from the Actions tab or runs automatically every Monday at 6 AM UTC.
