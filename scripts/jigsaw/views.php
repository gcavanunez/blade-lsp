<?php

$views = new class {
    public function all()
    {
        $finder = app('view')->getFinder();
        $results = [];

        // Registered view paths (typically [cachePath, source/])
        foreach ($finder->getPaths() as $path) {
            if (!is_dir($path)) {
                continue;
            }

            $files = \Symfony\Component\Finder\Finder::create()
                ->files()
                ->name('*.blade.php')
                ->in($path);

            $pathRealPath = realpath($path);

            foreach ($files as $file) {
                $realPath = $file->getRealPath();
                $relativePath = JigsawLsp::relativePath($realPath);

                $key = str($realPath)
                    ->replace($pathRealPath, '')
                    ->ltrim('/\\')
                    ->replace('.blade.php', '')
                    ->replace(['/', '\\'], '.');

                $type = $this->classifyView((string) $key);

                $results[] = [
                    'key' => (string) $key,
                    'path' => $relativePath,
                    'isVendor' => JigsawLsp::isVendor($realPath),
                    'type' => $type,
                ];
            }
        }

        // Hint-namespaced paths (if viewHintPaths configured in config.php)
        $hints = $finder->getHints();

        foreach ($hints as $namespace => $paths) {
            // Skip cache-generated hex namespaces
            if (strlen($namespace) === 32 && ctype_xdigit($namespace)) {
                continue;
            }

            foreach ($paths as $path) {
                if (!is_dir($path)) {
                    continue;
                }

                $files = \Symfony\Component\Finder\Finder::create()
                    ->files()
                    ->name('*.blade.php')
                    ->in($path);

                $pathRealPath = realpath($path);

                foreach ($files as $file) {
                    $realPath = $file->getRealPath();

                    $key = str($realPath)
                        ->replace($pathRealPath, '')
                        ->ltrim('/\\')
                        ->replace('.blade.php', '')
                        ->replace(['/', '\\'], '.');

                    $results[] = [
                        'key' => "{$namespace}::{$key}",
                        'path' => JigsawLsp::relativePath($realPath),
                        'isVendor' => JigsawLsp::isVendor($realPath),
                        'type' => $this->classifyView((string) $key),
                    ];
                }
            }
        }

        return $results;
    }

    /**
     * Classify a view key by Jigsaw convention:
     * - _components.* -> component (anonymous blade components)
     * - _layouts.*    -> layout
     * - _partials.*   -> partial
     * - _*            -> partial (any underscore-prefixed directory)
     * - everything else -> page
     */
    protected function classifyView(string $key): string
    {
        if (str_starts_with($key, '_components.')) return 'component';
        if (str_starts_with($key, '_layouts.'))    return 'layout';
        if (str_starts_with($key, '_partials.'))   return 'partial';
        if (str_starts_with($key, '_'))            return 'partial';
        return 'page';
    }
};

echo json_encode($views->all());
