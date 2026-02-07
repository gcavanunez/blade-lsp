import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import * as fs from 'fs';
import { PhpEnvironment } from '../../src/laravel/php-environment';

// Mock child_process.execSync and fs.existsSync
vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

// We need to partially mock fs — keep real implementations except existsSync
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof fs>();
    return {
        ...actual,
        existsSync: vi.fn(),
    };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedExecSync = child_process.execSync as any as ReturnType<typeof vi.fn>;
const mockedExistsSync = vi.mocked(fs.existsSync);

describe('PhpEnvironment', () => {
    const projectRoot = '/home/user/my-laravel-app';

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: no files exist, no commands succeed
        mockedExistsSync.mockReturnValue(false);
        mockedExecSync.mockImplementation(() => {
            throw new Error('command not found');
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('detect', () => {
        it('returns null when no environment is available', () => {
            const result = PhpEnvironment.detect(projectRoot);
            expect(result).toBeNull();
        });

        it('detects herd environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('herd which-php')) {
                    return '/usr/local/bin/php8.2';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('herd');
            expect(result!.label).toBe('Herd');
            expect(result!.phpCommand).toEqual(['/usr/local/bin/php8.2']);
            expect(result!.useRelativePaths).toBe(false);
        });

        it('rejects herd when output contains "No usable PHP version found"', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('herd which-php')) {
                    return 'No usable PHP version found';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            // Should fall through herd and try other environments (all fail)
            expect(result).toBeNull();
        });

        it('detects valet environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('valet which-php')) {
                    return '/usr/local/bin/php8.3';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('valet');
            expect(result!.label).toBe('Valet');
            expect(result!.phpCommand).toEqual(['/usr/local/bin/php8.3']);
            expect(result!.useRelativePaths).toBe(false);
        });

        it('detects sail environment when vendor/bin/sail exists', () => {
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('vendor/bin/sail');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('sail ps')) {
                    return 'laravel.test running';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('sail');
            expect(result!.label).toBe('Sail');
            expect(result!.phpCommand).toEqual(['./vendor/bin/sail', 'php']);
            expect(result!.useRelativePaths).toBe(true);
        });

        it('skips sail when vendor/bin/sail does not exist', () => {
            // sail requires vendor/bin/sail file — it shouldn't even try execSync
            mockedExistsSync.mockReturnValue(false);
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('sail')) {
                    // If it gets here despite no file, we have a bug
                    return 'running';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).toBeNull();
        });

        it('detects lando environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('lando php')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('lando');
            expect(result!.label).toBe('Lando');
            expect(result!.phpCommand).toEqual(['lando', 'php']);
            expect(result!.useRelativePaths).toBe(true);
        });

        it('detects ddev environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('ddev php')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('ddev');
            expect(result!.label).toBe('DDEV');
            expect(result!.phpCommand).toEqual(['ddev', 'php']);
            expect(result!.useRelativePaths).toBe(true);
        });

        it('detects local php environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.startsWith('php -r')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('local');
            expect(result!.label).toBe('Local');
            expect(result!.phpCommand).toEqual(['/usr/bin/php']);
            expect(result!.useRelativePaths).toBe(false);
        });

        it('detects docker compose environment', () => {
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('docker-compose.yml');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('docker compose ps')) {
                    return JSON.stringify([{ Name: 'app', State: 'running' }]);
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('docker');
            expect(result!.label).toBe('Docker Compose');
            expect(result!.phpCommand).toEqual(['docker', 'compose', 'exec', '-T', 'app', 'php']);
            expect(result!.useRelativePaths).toBe(true);
        });

        it('rejects docker compose when no running containers', () => {
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('docker-compose.yml');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('docker compose ps')) {
                    return '[]';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).toBeNull();
        });

        it('rejects docker compose when output is empty', () => {
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('compose.yaml');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('docker compose ps')) {
                    return '';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).toBeNull();
        });

        it('accepts any docker-compose file variant', () => {
            // compose.yaml should also work
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('compose.yaml');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('docker compose ps')) {
                    return JSON.stringify([{ Name: 'web', State: 'running' }]);
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result).not.toBeNull();
            expect(result!.name).toBe('docker');
        });
    });

    describe('detect with preferredEnv', () => {
        it('tries only the preferred environment', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('lando php')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot, 'lando');
            expect(result).not.toBeNull();
            expect(result!.name).toBe('lando');
        });

        it('returns null if preferred environment fails', () => {
            // Everything fails by default
            const result = PhpEnvironment.detect(projectRoot, 'herd');
            expect(result).toBeNull();
        });

        it('does not fall through to other environments when preferred fails', () => {
            // Local php is available, but we ask for herd specifically
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('php -r')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot, 'herd');
            expect(result).toBeNull();
        });
    });

    describe('detection order', () => {
        it('prefers herd over valet when both are available', () => {
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('herd which-php')) {
                    return '/herd/php';
                }
                if (typeof cmd === 'string' && cmd.includes('valet which-php')) {
                    return '/valet/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result!.name).toBe('herd');
        });

        it('prefers sail over local when sail file exists and succeeds', () => {
            mockedExistsSync.mockImplementation((filePath) => {
                return String(filePath).endsWith('vendor/bin/sail');
            });
            mockedExecSync.mockImplementation((cmd) => {
                if (typeof cmd === 'string' && cmd.includes('sail ps')) {
                    return 'running';
                }
                if (typeof cmd === 'string' && cmd.includes('php -r')) {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result!.name).toBe('sail');
        });

        it('falls through to local when earlier environments fail', () => {
            mockedExecSync.mockImplementation((cmd) => {
                // Only local php works
                if (typeof cmd === 'string' && cmd === 'php -r "echo PHP_BINARY;"') {
                    return '/usr/bin/php';
                }
                throw new Error('command not found');
            });

            const result = PhpEnvironment.detect(projectRoot);
            expect(result!.name).toBe('local');
        });
    });
});
