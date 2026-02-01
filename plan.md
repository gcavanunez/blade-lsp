# Laravel Integration Plan

## Goal

Extract Blade-related affordances from a Laravel project by running PHP scripts, similar to how the VS Code extension works.

---

## How the VS Code Extension Does It

### 1. PHP Templates
Located in `php-templates/`, these are PHP scripts that get executed in the Laravel context:

```php
// php-templates/views.php
echo collect(app('view')->getFinder()->getHints())
    ->merge(['default' => resource_path('views')])
    ->flatMap(fn($paths, $namespace) => /* scan for blade files */)
    ->toJson();
```

### 2. Execution Method
The extension runs these scripts via:
```bash
php artisan tinker --execute="require 'php-templates/views.php'"
# or
php -r "require 'bootstrap/app.php'; /* script */"
```

### 3. Caching
Results are cached and refreshed on:
- File changes in watched directories
- Manual refresh command
- LSP restart

---

## Our Implementation Plan

### Phase 1: Project Detection & PHP Execution

#### 1.1 Detect Laravel Project
```typescript
// src/laravel/project.ts
interface LaravelProject {
  root: string;           // Project root path
  artisanPath: string;    // path to artisan
  composerPath: string;   // path to composer.json
  phpPath: string;        // PHP binary path
}

function detectLaravelProject(workspaceRoot: string): LaravelProject | null {
  // Look for artisan, composer.json with laravel/framework
}
```

#### 1.2 PHP Script Runner
```typescript
// src/laravel/php-runner.ts
interface PhpRunnerOptions {
  script: string;         // PHP code to execute
  cwd: string;            // Laravel project root
  timeout?: number;       // Execution timeout
}

async function runPhpScript(options: PhpRunnerOptions): Promise<string> {
  // Option 1: Use artisan tinker
  // php artisan tinker --execute="..."
  
  // Option 2: Bootstrap Laravel directly
  // php -r "require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; ..."
  
  // Option 3: Custom PHP script that bootstraps Laravel
  // php scripts/extract.php --type=views
}
```

### Phase 2: Data Extraction Scripts

#### 2.1 Views Extraction
```php
// scripts/extract-views.php
<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$finder = app('view')->getFinder();
$views = [];

// Get all view paths
foreach ($finder->getPaths() as $path) {
    $views = array_merge($views, scanBladeFiles($path, ''));
}

// Get namespaced views (packages)
foreach ($finder->getHints() as $namespace => $paths) {
    foreach ($paths as $path) {
        $views = array_merge($views, scanBladeFiles($path, $namespace . '::'));
    }
}

echo json_encode($views);
```

**Data Structure:**
```typescript
interface ViewItem {
  key: string;           // 'layouts.app' or 'mail::message'
  path: string;          // Full filesystem path
  relativePath: string;  // Relative to resources/views
  isVendor: boolean;     // From vendor package
  namespace?: string;    // Package namespace if applicable
}
```

#### 2.2 Components Extraction
```php
// scripts/extract-components.php
<?php
// Bootstrap Laravel...

$components = [];

// Anonymous components from resources/views/components
$componentPath = resource_path('views/components');
if (is_dir($componentPath)) {
    $components = array_merge($components, scanComponentFiles($componentPath, 'x-'));
}

// Class-based components
foreach (app('blade.compiler')->getClassComponentAliases() as $alias => $class) {
    $components[] = [
        'name' => $alias,
        'class' => $class,
        'type' => 'class',
    ];
}

// Package components (Flux, Livewire, etc.)
// ...

echo json_encode($components);
```

**Data Structure:**
```typescript
interface ComponentItem {
  name: string;          // 'button', 'alert'
  prefix: string;        // 'x-', 'flux:', 'livewire:'
  fullTag: string;       // 'x-button', 'flux:button'
  path?: string;         // File path for anonymous components
  class?: string;        // Class name for class-based components
  props?: PropItem[];    // Component props
  slots?: string[];      // Named slots
}

interface PropItem {
  name: string;
  type?: string;
  required: boolean;
  default?: string;
}
```

#### 2.3 Custom Directives Extraction
```php
// scripts/extract-directives.php
<?php
// Bootstrap Laravel...

$compiler = app('blade.compiler');
$directives = [];

foreach ($compiler->getCustomDirectives() as $name => $handler) {
    $reflection = is_array($handler) 
        ? new ReflectionMethod($handler[0], $handler[1])
        : new ReflectionFunction($handler);
    
    $directives[] = [
        'name' => $name,
        'hasParams' => $reflection->getNumberOfParameters() >= 1,
        'file' => $reflection->getFileName(),
        'line' => $reflection->getStartLine(),
    ];
}

echo json_encode($directives);
```

**Data Structure:**
```typescript
interface CustomDirective {
  name: string;          // 'datetime', 'money'
  hasParams: boolean;    // Whether it accepts parameters
  file?: string;         // Where it's defined
  line?: number;
}
```

#### 2.4 Sections/Stacks from Layout
```php
// scripts/extract-sections.php
<?php
// Given a layout file, extract @yield and @stack names

$layoutPath = $argv[1] ?? null;
if (!$layoutPath || !file_exists($layoutPath)) {
    echo json_encode([]);
    exit;
}

$content = file_get_contents($layoutPath);

preg_match_all('/@yield\s*\([\'"]([^\'"]+)[\'"]/', $content, $yields);
preg_match_all('/@stack\s*\([\'"]([^\'"]+)[\'"]/', $content, $stacks);

echo json_encode([
    'yields' => array_unique($yields[1]),
    'stacks' => array_unique($stacks[1]),
]);
```

### Phase 3: LSP Integration

#### 3.1 Repository Pattern
```typescript
// src/laravel/repositories/views.ts
class ViewRepository {
  private items: ViewItem[] = [];
  private lastUpdated: number = 0;
  
  async refresh(project: LaravelProject): Promise<void> {
    const result = await runPhpScript({
      script: extractViewsScript,
      cwd: project.root,
    });
    this.items = JSON.parse(result);
    this.lastUpdated = Date.now();
  }
  
  getItems(): ViewItem[] {
    return this.items;
  }
  
  find(key: string): ViewItem | undefined {
    return this.items.find(v => v.key === key);
  }
}
```

#### 3.2 Completion Provider Updates
```typescript
// When inside @extends('...')
if (context.directiveName === 'extends') {
  const views = viewRepository.getItems()
    .filter(v => v.key.startsWith('layouts.'));
  return views.map(v => createViewCompletionItem(v));
}

// When inside @include('...')
if (context.directiveName === 'include') {
  return viewRepository.getItems()
    .map(v => createViewCompletionItem(v));
}

// When typing <x-...
if (context.type === 'component') {
  return componentRepository.getItems()
    .map(c => createComponentCompletionItem(c));
}
```

#### 3.3 Hover Provider Updates
```typescript
// Hover on view name shows file path
if (isViewReference(node)) {
  const view = viewRepository.find(viewName);
  if (view) {
    return {
      contents: `**${view.key}**\n\n[${view.relativePath}](file://${view.path})`
    };
  }
}
```

#### 3.4 Diagnostics Updates
```typescript
// Check if referenced view exists
if (isViewReference(node)) {
  const view = viewRepository.find(viewName);
  if (!view) {
    diagnostics.push({
      message: `View not found: ${viewName}`,
      severity: DiagnosticSeverity.Error,
    });
  }
}
```

### Phase 4: File Watching

#### 4.1 Watch Patterns
```typescript
const watchPatterns = [
  'resources/views/**/*.blade.php',      // Views
  'app/View/Components/**/*.php',        // Class components
  'app/Providers/AppServiceProvider.php', // Custom directives
  'routes/**/*.php',                      // Route changes (for Livewire)
];
```

#### 4.2 Debounced Refresh
```typescript
// src/laravel/watcher.ts
class LaravelWatcher {
  private refreshTimeout: NodeJS.Timeout | null = null;
  
  onFileChange(uri: string): void {
    // Debounce refreshes
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    
    this.refreshTimeout = setTimeout(() => {
      this.refreshRepositories();
    }, 500);
  }
}
```

### Phase 5: Configuration

#### 5.1 LSP Settings
```typescript
interface BladeServerSettings {
  phpPath?: string;              // Custom PHP binary path
  laravelRoot?: string;          // Override project detection
  enableProjectIntegration: boolean;
  refreshOnSave: boolean;
  excludeVendorViews: boolean;
}
```

---

## Implementation Order

### Sprint 1: Foundation
1. [ ] Project detection (find artisan, composer.json)
2. [ ] PHP script runner (execute PHP and parse JSON output)
3. [ ] Basic views extraction
4. [ ] View completion in `@extends`, `@include`

### Sprint 2: Components
1. [ ] Component extraction (anonymous + class-based)
2. [ ] Component completion (`<x-...`)
3. [ ] Component prop completion
4. [ ] Slot completion

### Sprint 3: Directives & Sections
1. [ ] Custom directive extraction
2. [ ] Section/stack extraction from layouts
3. [ ] `@section`/`@push` completion based on parent layout

### Sprint 4: Diagnostics & Navigation
1. [ ] Missing view diagnostics
2. [ ] Go to definition for views
3. [ ] Go to definition for components
4. [ ] Hover with file paths

### Sprint 5: File Watching & Polish
1. [ ] File watcher integration
2. [ ] Debounced refresh
3. [ ] Cache persistence
4. [ ] Performance optimization

---

## File Structure

```
src/
├── server.ts
├── parser.ts
├── directives.ts
├── laravel/
│   ├── project.ts          # Project detection
│   ├── php-runner.ts       # PHP execution
│   ├── watcher.ts          # File watching
│   ├── repositories/
│   │   ├── views.ts
│   │   ├── components.ts
│   │   └── directives.ts
│   └── scripts/
│       ├── extract-views.php
│       ├── extract-components.php
│       └── extract-directives.php
└── providers/
    ├── completion.ts
    ├── hover.ts
    └── diagnostics.ts
```

---

## Alternative: Lightweight Approach (No PHP)

If running PHP is problematic, we can do filesystem-only scanning:

```typescript
// Scan resources/views directly without PHP
async function scanViews(viewsPath: string): Promise<ViewItem[]> {
  const files = await glob('**/*.blade.php', { cwd: viewsPath });
  return files.map(file => ({
    key: file.replace(/\.blade\.php$/, '').replace(/\//g, '.'),
    path: path.join(viewsPath, file),
  }));
}
```

**Pros:**
- No PHP dependency
- Faster
- Works without Laravel bootstrap

**Cons:**
- Can't get namespaced views from packages
- Can't get class-based component info
- Can't get custom directives

---

## Questions to Resolve

1. **PHP Execution Method**: artisan tinker vs direct bootstrap vs custom script?
2. **Caching Strategy**: In-memory only or persist to disk?
3. **Multi-root Workspaces**: How to handle multiple Laravel projects?
4. **Error Handling**: What if PHP script fails or Laravel isn't bootable?
5. **Vendor Views**: Include views from `vendor/` packages?
