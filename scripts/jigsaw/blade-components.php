<?php

$components = new class {
    public function all()
    {
        return [
            'components' => collect(array_merge(
                $this->getAnonymousComponents(),
                $this->getClassAliases(),
                $this->getNamespacedClasses(),
            ))->groupBy('key')->pipe($this->setProps(...))->map(fn($items) => [
                'isVendor' => $items->first()['isVendor'],
                'paths' => $items->pluck('path')->unique()->values(),
                'props' => $this->formatProps($items),
            ]),
            'prefixes' => [],
        ];
    }

    /**
     * Anonymous components in source/_components/
     * In Jigsaw, <x-alert /> resolves to source/_components/alert.blade.php
     * (note the underscore prefix — Jigsaw's ComponentTagCompiler prepends '_components')
     */
    protected function getAnonymousComponents()
    {
        $sourcePath = app()->path('source');
        $componentsPath = $sourcePath . '/_components';

        if (!is_dir($componentsPath)) {
            return [];
        }

        $files = \Symfony\Component\Finder\Finder::create()
            ->files()
            ->name('*.blade.php')
            ->in($componentsPath);

        $components = [];
        $basePath = realpath($componentsPath);

        foreach ($files as $file) {
            $realPath = $file->getRealPath();

            $key = str($realPath)
                ->replace($basePath, '')
                ->ltrim('/\\')
                ->replace('.blade.php', '')
                ->replace(['/', '\\'], '.')
                ->pipe(fn($str) => $this->handleIndexComponents($str));

            $components[] = [
                'key' => (string) $key,
                'path' => JigsawLsp::relativePath($realPath),
                'isVendor' => false,
            ];
        }

        return $components;
    }

    /**
     * Class-based components registered as aliases in bootstrap.php:
     *   $bladeCompiler->component('alert', AlertComponent::class);
     */
    protected function getClassAliases()
    {
        $compiler = app('blade.compiler');
        $components = [];

        foreach ($compiler->getClassComponentAliases() as $key => $class) {
            if (!class_exists($class)) {
                continue;
            }

            $reflection = new ReflectionClass($class);

            $components[] = [
                'key' => $key,
                'path' => JigsawLsp::relativePath($reflection->getFileName()),
                'isVendor' => JigsawLsp::isVendor($reflection->getFileName()),
                'props' => $this->getClassProps($class, $reflection),
            ];
        }

        return $components;
    }

    /**
     * Class-based components under the Components\ namespace.
     * Jigsaw's ComponentTagCompiler::guessClassName resolves
     * <x-foo-bar /> to Components\FooBar.
     */
    protected function getNamespacedClasses()
    {
        $autoloadFile = app()->path('vendor/composer/autoload_psr4.php');

        if (!file_exists($autoloadFile)) {
            return [];
        }

        $autoloaded = require $autoloadFile;
        $components = [];

        foreach ($autoloaded as $namespace => $paths) {
            if ($namespace !== 'Components\\') {
                continue;
            }

            foreach ($paths as $dir) {
                if (!is_dir($dir)) {
                    continue;
                }

                $files = \Symfony\Component\Finder\Finder::create()
                    ->files()
                    ->name('*.php')
                    ->in($dir);

                $dirRealPath = realpath($dir);

                foreach ($files as $file) {
                    $realPath = $file->getRealPath();

                    $key = str($realPath)
                        ->replace($dirRealPath, '')
                        ->ltrim('/\\')
                        ->replace('.php', '')
                        ->replace(['/', '\\'], '.')
                        ->kebab();

                    $class = 'Components\\' . str($file->getRelativePathname())
                        ->replace('.php', '')
                        ->replace('/', '\\')
                        ->toString();

                    $props = [];

                    if (class_exists($class)) {
                        $reflection = new ReflectionClass($class);
                        $props = $this->getClassProps($class, $reflection);
                    }

                    $components[] = [
                        'key' => (string) $key,
                        'path' => JigsawLsp::relativePath($realPath),
                        'isVendor' => false,
                        'props' => $props,
                    ];
                }
            }
        }

        return $components;
    }

    protected function getClassProps(string $class, ReflectionClass $reflection)
    {
        $parameters = collect($reflection->getConstructor()?->getParameters() ?? [])
            ->filter(fn($p) => $p->isPromoted())
            ->flatMap(fn($p) => [$p->getName() => $p->isOptional() ? $p->getDefaultValue() : null])
            ->all();

        return collect($reflection->getProperties())
            ->filter(fn($p) => $p->isPublic() && $p->getDeclaringClass()->getName() === $class)
            ->map(fn($p) => [
                'name' => \Illuminate\Support\Str::kebab($p->getName()),
                'type' => (string) ($p->getType() ?? 'mixed'),
                'default' => $p->getDefaultValue() ?? $parameters[$p->getName()] ?? null,
            ])
            ->values();
    }

    protected function handleIndexComponents($str)
    {
        if ($str->endsWith('.index')) {
            return $str->replaceLast('.index', '');
        }

        if (!$str->contains('.')) {
            return $str;
        }

        $parts = $str->explode('.');

        if ($parts->slice(-2)->unique()->count() === 1) {
            $parts->pop();
            return str($parts->implode('.'));
        }

        return $str;
    }

    protected function formatProps($items)
    {
        $props = $items->pluck('props');

        if ($codeBlock = $props->firstWhere(fn ($prop) => is_string($prop))) {
            return $codeBlock;
        }

        return $props->values()->filter()->flatMap(fn($i) => $i);
    }

    protected function setProps($groups)
    {
        try {
            $compiler = app('blade.compiler');
        } catch (\Throwable $e) {
            return $groups;
        }

        return $groups->map(function ($group) use ($compiler) {
            return $group->transform(function ($component) use ($compiler) {
                if (isset($component['props'])) {
                    return $component;
                }

                if (!str($component['path'])->endsWith('.blade.php')) {
                    return $component;
                }

                if (!$props = $this->parseProps($compiler, $component)) {
                    return $component;
                }

                return array_merge($component, ['props' => $props]);
            });
        });
    }

    protected function parseProps($compiler, array $component): ?string
    {
        $fullPath = app()->path($component['path']);

        if (!file_exists($fullPath)) {
            return null;
        }

        $content = file_get_contents($fullPath);
        $result = '';

        $compiler->directive('props', function ($expression) use (&$result) {
            return $result = $expression;
        });

        $compiler->compileString($content);

        if (empty($result)) {
            return null;
        }

        return '@props(' . $result . ')';
    }
};

echo json_encode($components->all());
