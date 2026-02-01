<?php

/**
 * Extract all custom Blade directives from a Laravel project
 * Returns JSON array of directive info
 */

use Illuminate\View\Compilers\BladeCompiler;

$compiler = app(BladeCompiler::class);
$directives = [];

foreach ($compiler->getCustomDirectives() as $name => $handler) {
    $directive = [
        'name' => $name,
        'hasParams' => false,
        'file' => null,
        'line' => null,
    ];

    try {
        if ($handler instanceof \Closure) {
            $reflection = new ReflectionFunction($handler);
            $directive['hasParams'] = $reflection->getNumberOfParameters() >= 1;
            $directive['file'] = BladeLspHelper::relativePath($reflection->getFileName());
            $directive['line'] = $reflection->getStartLine();
        } elseif (is_array($handler)) {
            $reflection = new ReflectionMethod($handler[0], $handler[1]);
            $directive['hasParams'] = $reflection->getNumberOfParameters() >= 1;
            $directive['file'] = BladeLspHelper::relativePath($reflection->getFileName());
            $directive['line'] = $reflection->getStartLine();
        }
    } catch (\Throwable $e) {
        // If reflection fails, just include basic info
    }

    $directives[] = $directive;
}

// Sort alphabetically
usort($directives, fn($a, $b) => strcasecmp($a['name'], $b['name']));

echo json_encode($directives);
