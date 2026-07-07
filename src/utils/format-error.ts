import { UnknownError } from './error';
import { PhpRunner } from '../laravel/php-runner';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { Directives } from '../laravel/directives';
import { Laravel } from '../laravel/index';

export namespace ErrorFormat {
    /**
     * Format a RefreshError with its cause chain for better diagnostics.
     * Walks the `cause` field to find the underlying PhpRunner error and includes its details.
     */
    function formatRefreshError(domain: string, input: { message: string; cause?: unknown }): string {
        const header = `Failed to refresh ${domain}: ${input.message}`;

        const cause = input.cause;
        if (cause) {
            const causeFormatted = format(cause);
            if (causeFormatted) {
                return `${header}\n${causeFormatted}`;
            }
            if (cause instanceof Error) {
                return `${header} (${cause.message})`;
            }
        }

        return header;
    }

    /**
     * Format an error for user-facing display.
     * Returns a human-readable message for known errors, or undefined for unknown errors.
     *
     * Usage:
     * ```ts
     * const formatted = ErrorFormat.format(err)
     * if (formatted) {
     *   conn.console.error(formatted)
     * } else {
     *   conn.console.error(`Unexpected error: ${err}`)
     * }
     * ```
     */
    export function format(input: unknown): string | undefined {
        if (input instanceof PhpRunner.ScriptNotFoundError) {
            return input.message;
        }

        if (input instanceof PhpRunner.VendorDirError) {
            return `Failed to create vendor directory: ${input.message}`;
        }

        if (input instanceof PhpRunner.WriteError) {
            return `Failed to write PHP script: ${input.message}`;
        }

        if (input instanceof PhpRunner.TimeoutError) {
            return input.message;
        }

        if (input instanceof PhpRunner.StartupError) {
            return `Laravel failed to start: ${input.message}`;
        }

        if (input instanceof PhpRunner.OutputError) {
            const parts = [`Invalid PHP output: ${input.message}`];
            if (input.stdout) parts.push(`stdout: ${input.stdout}`);
            if (input.stderr) parts.push(`stderr: ${input.stderr}`);
            return parts.join('\n');
        }

        if (input instanceof PhpRunner.ParseError) {
            return `Failed to parse PHP output: ${input.message}`;
        }

        if (input instanceof PhpRunner.SpawnError) {
            return `Failed to run PHP command '${input.command}': ${input.message}`;
        }

        if (input instanceof Views.RefreshError) {
            return formatRefreshError('views', input);
        }

        if (input instanceof Components.RefreshError) {
            return formatRefreshError('components', input);
        }

        if (input instanceof Directives.RefreshError) {
            return formatRefreshError('directives', input);
        }

        if (input instanceof Laravel.NotDetectedError) {
            return `No Laravel project detected in ${input.workspaceRoot}`;
        }

        if (input instanceof Laravel.ValidationError) {
            const msg = input.message ? `: ${input.message}` : '';
            return `Laravel project validation failed at ${input.projectRoot}${msg}`;
        }

        if (input instanceof Laravel.NotAvailableError) {
            return input.message || 'Laravel integration not available';
        }

        if (input instanceof UnknownError) {
            return input.message;
        }

        return undefined;
    }

    /**
     * Format an error for logging (includes more detail than user-facing).
     * Always returns a string. Walks the cause chain for full context.
     */
    export function forLog(input: unknown): string {
        const formatted = format(input);
        if (formatted) return formatted;

        if (input instanceof Error) {
            const parts = [input.stack || input.message];
            if (input.cause) {
                parts.push(`Caused by: ${forLog(input.cause)}`);
            }
            return parts.join('\n');
        }

        return String(input);
    }

    /**
     * Convert an error to a structured object for logging.
     * Serializes tagged errors as `{ name, data }`, extracts useful info from regular Errors.
     */
    export function toObject(input: unknown): Record<string, unknown> {
        // Effect Schema tagged errors: own enumerable props are `_tag` + fields.
        if (input instanceof Error && '_tag' in input && typeof input._tag === 'string') {
            const { _tag, cause, ...fields } = { ...(input as Error & { _tag: string; cause?: unknown }) };
            return {
                name: _tag,
                data: fields,
                ...(cause !== undefined ? { cause: toObject(cause) } : {}),
            };
        }

        if (input instanceof Error) {
            return {
                name: input.name,
                message: input.message,
                stack: input.stack,
                cause: input.cause ? toObject(input.cause) : undefined,
            };
        }

        return { message: String(input) };
    }
}
