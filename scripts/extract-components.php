<?php

/**
 * Extract all Blade components from a Laravel project
 * Returns JSON with components and prefixes
 */

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Str;

$components = [];
$prefixes = [];

// Helper to find files in a directory
function findBladeFiles($path, $extension = 'blade.php') {
    $files = [];
    
    if (!is_dir($path)) {
        return $files;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, RecursiveDirectoryIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if ($file->isDir()) {
            continue;
        }

        $realPath = $file->getRealPath();

        if (!str_ends_with($realPath, '.' . $extension)) {
            continue;
        }

        $files[] = $realPath;
    }

    return $files;
}

// Helper to convert path to component key
function pathToKey($realPath, $basePath, $prefix = '') {
    $relativePath = str_replace(realpath($basePath), '', $realPath);
    $relativePath = ltrim($relativePath, DIRECTORY_SEPARATOR);
    
    // Remove extension
    $key = preg_replace('/\.blade\.php$|\.php$/', '', $relativePath);
    
    // Convert path separators to dots and kebab-case
    $key = str_replace(DIRECTORY_SEPARATOR, '.', $key);
    $parts = explode('.', $key);
    $parts = array_map(fn($p) => Str::kebab($p), $parts);
    $key = implode('.', $parts);
    
    // Handle index components (button/button.blade.php -> button)
    $keyParts = explode('.', $key);
    if (count($keyParts) >= 2) {
        $last = end($keyParts);
        $secondLast = $keyParts[count($keyParts) - 2];
        if ($last === $secondLast || $last === 'index') {
            array_pop($keyParts);
            $key = implode('.', $keyParts);
        }
    }

    return $prefix ? $prefix . $key : $key;
}

// 1. Anonymous components from resources/views/components
$anonymousPath = resource_path('views/components');
if (is_dir($anonymousPath)) {
    foreach (findBladeFiles($anonymousPath) as $filePath) {
        $key = pathToKey($filePath, $anonymousPath);
        $components[] = [
            'key' => $key,
            'fullTag' => 'x-' . $key,
            'path' => BladeLspHelper::relativePath($filePath),
            'isVendor' => false,
            'type' => 'anonymous',
            'props' => extractPropsFromFile($filePath),
        ];
    }
}

// 2. Class-based components from app/View/Components
$classPath = app_path('View/Components');
if (is_dir($classPath)) {
    foreach (findBladeFiles($classPath, 'php') as $filePath) {
        $key = pathToKey($filePath, $classPath);
        $className = getClassNameFromFile($filePath);
        
        $components[] = [
            'key' => $key,
            'fullTag' => 'x-' . $key,
            'path' => BladeLspHelper::relativePath($filePath),
            'isVendor' => false,
            'type' => 'class',
            'class' => $className,
            'props' => $className ? extractPropsFromClass($className) : [],
        ];
    }
}

// 3. Component aliases
foreach (Blade::getClassComponentAliases() as $alias => $class) {
    if (!class_exists($class)) {
        continue;
    }
    
    $reflection = new ReflectionClass($class);
    
    $components[] = [
        'key' => $alias,
        'fullTag' => 'x-' . $alias,
        'path' => BladeLspHelper::relativePath($reflection->getFileName()),
        'isVendor' => BladeLspHelper::isVendor($reflection->getFileName()),
        'type' => 'alias',
        'class' => $class,
        'props' => extractPropsFromClass($class),
    ];
}

// 4. Anonymous component namespaces
foreach (Blade::getAnonymousComponentNamespaces() as $prefix => $dir) {
    $path = is_dir($dir) ? $dir : resource_path('views/' . $dir);
    
    if (!is_dir($path)) {
        continue;
    }

    foreach (findBladeFiles($path) as $filePath) {
        $key = pathToKey($filePath, $path);
        $fullKey = $prefix . '::' . $key;
        
        $components[] = [
            'key' => $fullKey,
            'fullTag' => $prefix . '::' . $key,
            'path' => BladeLspHelper::relativePath($filePath),
            'isVendor' => BladeLspHelper::isVendor($filePath),
            'type' => 'anonymous-namespaced',
            'props' => extractPropsFromFile($filePath),
        ];
    }

    if (!in_array($prefix, $prefixes)) {
        $prefixes[] = $prefix;
    }
}

// 5. Anonymous component paths (e.g., Flux components)
foreach (Blade::getAnonymousComponentPaths() as $item) {
    $path = $item['path'];
    $prefix = $item['prefix'] ?? '';
    
    if (!is_dir($path)) {
        continue;
    }

    foreach (findBladeFiles($path) as $filePath) {
        $key = pathToKey($filePath, $path);
        
        // Standard x- prefix
        $fullTag = $prefix ? $prefix . '::' . $key : 'x-' . $key;
        
        $components[] = [
            'key' => $prefix ? $prefix . '::' . $key : $key,
            'fullTag' => $fullTag,
            'path' => BladeLspHelper::relativePath($filePath),
            'isVendor' => BladeLspHelper::isVendor($filePath),
            'type' => 'anonymous-path',
            'props' => extractPropsFromFile($filePath),
        ];
        
        // Special handling for flux: prefix
        if ($prefix === 'flux') {
            $components[] = [
                'key' => 'flux:' . $key,
                'fullTag' => 'flux:' . $key,
                'path' => BladeLspHelper::relativePath($filePath),
                'isVendor' => BladeLspHelper::isVendor($filePath),
                'type' => 'anonymous-path',
                'props' => extractPropsFromFile($filePath),
            ];
        }
    }

    if ($prefix && !in_array($prefix, $prefixes)) {
        $prefixes[] = $prefix;
    }
}

// 6. Class component namespaces
foreach (Blade::getClassComponentNamespaces() as $prefix => $namespace) {
    // Try to find the path for this namespace via autoload
    $autoload = require base_path('vendor/composer/autoload_psr4.php');
    
    foreach ($autoload as $ns => $paths) {
        if (!str_starts_with($namespace, $ns)) {
            continue;
        }
        
        foreach ($paths as $basePath) {
            $suffix = str_replace($ns, '', $namespace);
            $suffix = str_replace('\\', DIRECTORY_SEPARATOR, $suffix);
            $path = $basePath . DIRECTORY_SEPARATOR . $suffix;
            
            if (!is_dir($path)) {
                continue;
            }
            
            foreach (findBladeFiles($path, 'php') as $filePath) {
                $key = pathToKey($filePath, $path);
                $fullKey = $prefix . '::' . $key;
                
                $components[] = [
                    'key' => $fullKey,
                    'fullTag' => $prefix . '::' . $key,
                    'path' => BladeLspHelper::relativePath($filePath),
                    'isVendor' => BladeLspHelper::isVendor($filePath),
                    'type' => 'class-namespaced',
                    'props' => [],
                ];
            }
        }
    }

    if (!in_array($prefix, $prefixes)) {
        $prefixes[] = $prefix;
    }
}

// 7. Vendor components (from view hints)
$viewFinder = app('view')->getFinder();
foreach ($viewFinder->getHints() as $namespace => $paths) {
    // Skip hash-like namespaces
    if (strlen($namespace) === 32 && ctype_xdigit($namespace)) {
        continue;
    }
    
    foreach ($paths as $path) {
        $componentsPath = $path . '/components';
        
        if (!is_dir($componentsPath)) {
            continue;
        }
        
        foreach (findBladeFiles($componentsPath) as $filePath) {
            $key = pathToKey($filePath, $componentsPath);
            $fullKey = $namespace . '::' . $key;
            
            $components[] = [
                'key' => $fullKey,
                'fullTag' => $namespace . '::' . $key,
                'path' => BladeLspHelper::relativePath($filePath),
                'isVendor' => BladeLspHelper::isVendor($filePath),
                'type' => 'vendor',
                'props' => extractPropsFromFile($filePath),
            ];
        }
    }
}

/**
 * Extract @props from a Blade file
 */
function extractPropsFromFile($filePath) {
    $content = file_get_contents($filePath);
    
    if (preg_match('/@props\s*\(\s*(\[[\s\S]*?\])\s*\)/', $content, $matches)) {
        return '@props(' . $matches[1] . ')';
    }
    
    return null;
}

/**
 * Get class name from a PHP file
 */
function getClassNameFromFile($filePath) {
    $content = file_get_contents($filePath);
    
    $namespace = '';
    if (preg_match('/namespace\s+([^;]+);/', $content, $matches)) {
        $namespace = $matches[1] . '\\';
    }
    
    if (preg_match('/class\s+(\w+)/', $content, $matches)) {
        return $namespace . $matches[1];
    }
    
    return null;
}

/**
 * Extract props from a component class
 */
function extractPropsFromClass($className) {
    if (!class_exists($className)) {
        return [];
    }
    
    try {
        $reflection = new ReflectionClass($className);
        $constructor = $reflection->getConstructor();
        
        if (!$constructor) {
            return [];
        }
        
        $props = [];
        foreach ($constructor->getParameters() as $param) {
            if (!$param->isPromoted()) {
                continue;
            }
            
            $props[] = [
                'name' => Str::kebab($param->getName()),
                'type' => (string) ($param->getType() ?? 'mixed'),
                'required' => !$param->isOptional(),
                'default' => $param->isOptional() ? $param->getDefaultValue() : null,
            ];
        }
        
        return $props;
    } catch (\Throwable $e) {
        return [];
    }
}

// Remove duplicates by key
$uniqueComponents = [];
foreach ($components as $component) {
    $key = $component['key'];
    if (!isset($uniqueComponents[$key])) {
        $uniqueComponents[$key] = $component;
    }
}

echo json_encode([
    'components' => array_values($uniqueComponents),
    'prefixes' => $prefixes,
]);
