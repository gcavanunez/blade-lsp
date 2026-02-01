<?php

/**
 * Extract all Blade views from a Laravel project
 * Returns JSON array of view items
 */

$finder = app('view')->getFinder();
$views = [];

// Get all registered view paths
$paths = $finder->getPaths();

foreach ($paths as $viewPath) {
    if (!is_dir($viewPath)) {
        continue;
    }

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($viewPath, RecursiveDirectoryIterator::SKIP_DOTS)
    );

    foreach ($files as $file) {
        if ($file->isDir()) {
            continue;
        }

        $realPath = $file->getRealPath();
        $extensions = ['.blade.php', '.php'];
        $matchedExtension = null;

        foreach ($extensions as $ext) {
            if (str_ends_with($realPath, $ext)) {
                $matchedExtension = $ext;
                break;
            }
        }

        if (!$matchedExtension) {
            continue;
        }

        // Calculate view key (e.g., 'layouts.app', 'components.button')
        $relativePath = str_replace(realpath($viewPath), '', $realPath);
        $relativePath = ltrim($relativePath, DIRECTORY_SEPARATOR);
        $viewKey = str_replace(DIRECTORY_SEPARATOR, '.', $relativePath);
        $viewKey = preg_replace('/\.blade\.php$|\.php$/', '', $viewKey);

        $views[] = [
            'key' => $viewKey,
            'path' => BladeLspHelper::relativePath($realPath),
            'isVendor' => BladeLspHelper::isVendor($realPath),
            'namespace' => null,
        ];
    }
}

// Get namespaced/hinted views (from packages)
$hints = $finder->getHints();

foreach ($hints as $namespace => $hintPaths) {
    // Skip hash-like namespaces (internal Laravel)
    if (strlen($namespace) === 32 && ctype_xdigit($namespace)) {
        continue;
    }

    foreach ($hintPaths as $hintPath) {
        if (!is_dir($hintPath)) {
            continue;
        }

        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($hintPath, RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($files as $file) {
            if ($file->isDir()) {
                continue;
            }

            $realPath = $file->getRealPath();

            if (!str_ends_with($realPath, '.blade.php') && !str_ends_with($realPath, '.php')) {
                continue;
            }

            $relativePath = str_replace(realpath($hintPath), '', $realPath);
            $relativePath = ltrim($relativePath, DIRECTORY_SEPARATOR);
            $viewKey = str_replace(DIRECTORY_SEPARATOR, '.', $relativePath);
            $viewKey = preg_replace('/\.blade\.php$|\.php$/', '', $viewKey);

            $views[] = [
                'key' => $namespace . '::' . $viewKey,
                'path' => BladeLspHelper::relativePath($realPath),
                'isVendor' => BladeLspHelper::isVendor($realPath),
                'namespace' => $namespace,
            ];
        }
    }
}

// Sort views: local first, then vendor, alphabetically
usort($views, function ($a, $b) {
    if ($a['isVendor'] !== $b['isVendor']) {
        return $a['isVendor'] ? 1 : -1;
    }
    return strcasecmp($a['key'], $b['key']);
});

echo json_encode($views);
