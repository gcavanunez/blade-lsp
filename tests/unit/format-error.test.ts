import { describe, it, expect } from 'vitest';
import { FormatError, FormatErrorForLog, ErrorToObject } from '../../src/utils/format-error';
import { NamedError } from '../../src/utils/error';
import { PhpRunner } from '../../src/laravel/php-runner';
import { Views } from '../../src/laravel/views';
import { Components } from '../../src/laravel/components';
import { Directives } from '../../src/laravel/directives';
import { Laravel } from '../../src/laravel/index';

describe('FormatError', () => {
    describe('PhpRunner errors', () => {
        it('formats ScriptNotFoundError', () => {
            const err = new PhpRunner.ScriptNotFoundError({
                script: 'views',
                path: '/tmp/scripts/views.php',
            });
            expect(FormatError(err)).toBe("PHP script 'views' not found at /tmp/scripts/views.php");
        });

        it('formats VendorDirError', () => {
            const err = new PhpRunner.VendorDirError({ path: '/app/vendor/blade-lsp', message: 'Permission denied' });
            expect(FormatError(err)).toBe('Failed to create vendor directory: Permission denied');
        });

        it('formats WriteError', () => {
            const err = new PhpRunner.WriteError({ path: '/app/vendor/blade-lsp/script.php', message: 'ENOSPC' });
            expect(FormatError(err)).toBe('Failed to write PHP script: ENOSPC');
        });

        it('formats TimeoutError', () => {
            const err = new PhpRunner.TimeoutError({ timeoutMs: 30000, scriptName: 'views' });
            expect(FormatError(err)).toBe("PHP script 'views' timed out after 30000ms");
        });

        it('formats StartupError', () => {
            const err = new PhpRunner.StartupError({ message: 'Failed to bootstrap' });
            expect(FormatError(err)).toBe('Laravel failed to start: Failed to bootstrap');
        });

        it('formats OutputError with stdout and stderr', () => {
            const err = new PhpRunner.OutputError({
                message: 'Output markers not found',
                stdout: 'PHP Warning: ...',
                stderr: 'Some error output',
            });
            const result = FormatError(err)!;
            expect(result).toContain('Invalid PHP output: Output markers not found');
            expect(result).toContain('stdout: PHP Warning: ...');
            expect(result).toContain('stderr: Some error output');
        });

        it('formats OutputError without stdout/stderr', () => {
            const err = new PhpRunner.OutputError({ message: 'Output markers not found' });
            expect(FormatError(err)).toBe('Invalid PHP output: Output markers not found');
        });

        it('formats ParseError', () => {
            const err = new PhpRunner.ParseError({ message: 'Unexpected token', output: '{invalid' });
            expect(FormatError(err)).toBe('Failed to parse PHP output: Unexpected token');
        });

        it('formats SpawnError', () => {
            const err = new PhpRunner.SpawnError({ command: './vendor/bin/sail php', message: 'ENOENT' });
            expect(FormatError(err)).toBe("Failed to run PHP command './vendor/bin/sail php': ENOENT");
        });
    });

    describe('Views errors', () => {
        it('formats Views.RefreshError', () => {
            const err = new Views.RefreshError({ message: 'Failed to refresh views' });
            expect(FormatError(err)).toBe('Failed to refresh views: Failed to refresh views');
        });

        it('formats Views.RefreshError with cause chain', () => {
            const phpErr = new PhpRunner.SpawnError({ command: 'php', message: 'ENOENT' });
            const err = new Views.RefreshError(
                { message: 'Failed to refresh views', cause: 'ENOENT' },
                { cause: phpErr },
            );
            const result = FormatError(err)!;
            expect(result).toContain('Failed to refresh views: Failed to refresh views');
            expect(result).toContain("Failed to run PHP command 'php': ENOENT");
        });
    });

    describe('Components errors', () => {
        it('formats Components.RefreshError', () => {
            const err = new Components.RefreshError({ message: 'Failed to refresh components' });
            expect(FormatError(err)).toBe('Failed to refresh components: Failed to refresh components');
        });
    });

    describe('Directives errors', () => {
        it('formats Directives.RefreshError', () => {
            const err = new Directives.RefreshError({ message: 'Failed to refresh directives' });
            expect(FormatError(err)).toBe('Failed to refresh directives: Failed to refresh directives');
        });
    });

    describe('Laravel errors', () => {
        it('formats NotDetectedError', () => {
            const err = new Laravel.NotDetectedError({ workspaceRoot: '/home/user/project' });
            expect(FormatError(err)).toBe('No Laravel project detected in /home/user/project');
        });

        it('formats ValidationError with message', () => {
            const err = new Laravel.ValidationError({ projectRoot: '/app', message: 'Missing bootstrap/app.php' });
            expect(FormatError(err)).toBe('Laravel project validation failed at /app: Missing bootstrap/app.php');
        });

        it('formats ValidationError without message', () => {
            const err = new Laravel.ValidationError({ projectRoot: '/app' });
            expect(FormatError(err)).toBe('Laravel project validation failed at /app');
        });

        it('formats NotAvailableError', () => {
            const err = new Laravel.NotAvailableError({ message: 'Not initialized' });
            expect(FormatError(err)).toBe('Not initialized');
        });
    });

    describe('Unknown errors', () => {
        it('formats NamedError.Unknown', () => {
            const err = new NamedError.Unknown({ message: 'Something unexpected' });
            expect(FormatError(err)).toBe('Something unexpected');
        });

        it('returns undefined for plain Error', () => {
            expect(FormatError(new Error('plain error'))).toBeUndefined();
        });

        it('returns undefined for string', () => {
            expect(FormatError('some string')).toBeUndefined();
        });

        it('returns undefined for null', () => {
            expect(FormatError(null)).toBeUndefined();
        });
    });
});

describe('FormatErrorForLog', () => {
    it('uses FormatError for known errors', () => {
        const err = new PhpRunner.TimeoutError({ timeoutMs: 5000, scriptName: 'test' });
        expect(FormatErrorForLog(err)).toBe("PHP script 'test' timed out after 5000ms");
    });

    it('includes stack trace for plain Error', () => {
        const err = new Error('test error');
        const result = FormatErrorForLog(err);
        expect(result).toContain('test error');
        expect(result).toContain('Error:');
    });

    it('walks cause chain for plain Error', () => {
        const cause = new Error('root cause');
        const err = new Error('wrapper', { cause });
        const result = FormatErrorForLog(err);
        expect(result).toContain('wrapper');
        expect(result).toContain('Caused by:');
        expect(result).toContain('root cause');
    });

    it('formats string input', () => {
        expect(FormatErrorForLog('just a string')).toBe('just a string');
    });

    it('formats number input', () => {
        expect(FormatErrorForLog(42)).toBe('42');
    });

    it('walks cause chain with NamedError cause', () => {
        const phpErr = new PhpRunner.SpawnError({ command: 'php', message: 'ENOENT' });
        const err = new Error('wrapper', { cause: phpErr });
        const result = FormatErrorForLog(err);
        expect(result).toContain('wrapper');
        expect(result).toContain('Caused by:');
        expect(result).toContain('ENOENT');
    });
});

describe('ErrorToObject', () => {
    it('uses toObject() for NamedError', () => {
        const err = new PhpRunner.TimeoutError({ timeoutMs: 5000, scriptName: 'test' });
        const obj = ErrorToObject(err);
        expect(obj.name).toBe('PhpRunnerTimeoutError');
        expect(obj.data).toEqual({ timeoutMs: 5000, scriptName: 'test' });
    });

    it('extracts fields from plain Error', () => {
        const err = new Error('test error');
        const obj = ErrorToObject(err);
        expect(obj.name).toBe('Error');
        expect(obj.message).toBe('test error');
        expect(obj.stack).toBeDefined();
    });

    it('walks cause chain for plain Error', () => {
        const cause = new Error('inner');
        const err = new Error('outer', { cause });
        const obj = ErrorToObject(err);
        expect(obj.cause).toBeDefined();
        expect((obj.cause as Record<string, unknown>).message).toBe('inner');
    });

    it('handles non-Error input', () => {
        const obj = ErrorToObject('just a string');
        expect(obj.message).toBe('just a string');
    });
});
