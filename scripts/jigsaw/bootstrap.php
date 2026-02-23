<?php

error_reporting(E_ERROR | E_PARSE);

define('JIGSAW_START', microtime(true));

// Jigsaw sites have vendor in the project root
if (file_exists(getcwd() . '/vendor/autoload.php')) {
    require getcwd() . '/vendor/autoload.php';
}

class JigsawLsp
{
    private static $basePath;

    public static function basePath()
    {
        return self::$basePath ??= getcwd();
    }

    public static function relativePath($path)
    {
        $base = self::basePath();

        if (!str_contains($path, $base)) {
            return (string) $path;
        }

        return ltrim(str_replace($base, '', realpath($path) ?: $path), DIRECTORY_SEPARATOR);
    }

    public static function isVendor($path)
    {
        return str_contains($path, self::basePath() . DIRECTORY_SEPARATOR . 'vendor');
    }

    public static function outputMarker($key)
    {
        return '__BLADE_LSP_JIGSAW_' . $key . '__';
    }

    public static function startupError(\Throwable $e)
    {
        throw new Error(self::outputMarker('STARTUP_ERROR') . ': ' . $e->getMessage());
    }
}

try {
    $app = new TightenCo\Jigsaw\Container;

    $app->singleton(
        Illuminate\Contracts\Debug\ExceptionHandler::class,
        TightenCo\Jigsaw\Exceptions\Handler::class,
    );

    // Bootstrap: loads .env, config.php, registers all service providers
    // (ViewServiceProvider, BootstrapFileServiceProvider which loads blade.php + bootstrap.php, etc.)
    $app->bootstrapWith([
        TightenCo\Jigsaw\Bootstrap\HandleExceptions::class,
    ]);

    // Simulate what BuildCommand::updateBuildPaths() does so that the
    // ViewServiceProvider's deferred view.finder binding gets the right paths.
    // Without this, buildPath['views'] is unset and the FileViewFinder blows up.
    $sourcePath = $app->path('source');
    $app->buildPath = [
        'source' => $sourcePath,
        'views' => $sourcePath,
        'destination' => $app->path('build_local'),
    ];

} catch (\Throwable $e) {
    JigsawLsp::startupError($e);
    exit(1);
}

echo JigsawLsp::outputMarker('START_OUTPUT');
__JIGSAW_LSP_OUTPUT__;
echo JigsawLsp::outputMarker('END_OUTPUT');

exit(0);
