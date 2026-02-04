<?php

error_reporting(E_ERROR | E_PARSE);

define('LARAVEL_START', microtime(true));

// Scripts are written to vendor/blade-lsp/ so paths are relative from there
// This allows the same script to work in both local and Docker environments
require_once __DIR__ . '/../autoload.php';

class BladeLspHelper
{
    public static function relativePath($path)
    {
        if (!str_contains($path, base_path())) {
            return (string) $path;
        }

        return ltrim(str_replace(base_path(), '', realpath($path) ?: $path), DIRECTORY_SEPARATOR);
    }

    public static function isVendor($path)
    {
        return str_contains($path, base_path("vendor"));
    }

    public static function outputMarker($key)
    {
        return '__BLADE_LSP_' . $key . '__';
    }

    public static function startupError(\Throwable $e)
    {
        throw new Error(self::outputMarker('STARTUP_ERROR') . ': ' . $e->getMessage());
    }
}

try {
    $app = require_once __DIR__ . '/../../bootstrap/app.php';
} catch (\Throwable $e) {
    BladeLspHelper::startupError($e);
    exit(1);
}

$app->register(new class($app) extends \Illuminate\Support\ServiceProvider
{
    public function boot()
    {
        config([
            'logging.channels.null' => [
                'driver' => 'monolog',
                'handler' => \Monolog\Handler\NullHandler::class,
            ],
            'logging.default' => 'null',
        ]);
    }
});

try {
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
} catch (\Throwable $e) {
    BladeLspHelper::startupError($e);
    exit(1);
}

echo BladeLspHelper::outputMarker('START_OUTPUT');
__BLADE_LSP_OUTPUT__;
echo BladeLspHelper::outputMarker('END_OUTPUT');

exit(0);
