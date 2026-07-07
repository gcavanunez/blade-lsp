import { NamedError } from './error';
import { PhpRunner } from '../laravel/php-runner';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { Directives } from '../laravel/directives';
import { Laravel } from '../laravel/index';

export namespace ErrorFormat {
    /**
     * Format a RefreshError with its cause chain for better diagnostics.
     * Walks the error.cause to find the underlying PhpRunner error and includes its details.
     */
    function formatRefreshError(domain: string, input: Error & { data: { message: string; cause?: string } }): string {
        const header = `Failed to refresh ${domain}: ${input.data.message}`;

        const cause = input.cause;
        if (cause) {
            const causeFormatted = format(cause);
            if (causeFormatted) {
                return `${header}\n${causeFormatted}`;
            }
        }

        if (input.data.cause) {
            return `${header} (${input.data.cause})`;
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

        if (Views.RefreshError.isInstance(input)) {
            return formatRefreshError('views', input);
        }

        if (Components.RefreshError.isInstance(input)) {
            return formatRefreshError('components', input);
        }

        if (Directives.RefreshError.isInstance(input)) {
            return formatRefreshError('directives', input);
        }

        if (Laravel.NotDetectedError.isInstance(input)) {
            return `No Laravel project detected in ${input.data.workspaceRoot}`;
        }

        if (Laravel.ValidationError.isInstance(input)) {
            const msg = input.data.message ? `: ${input.data.message}` : '';
            return `Laravel project validation failed at ${input.data.projectRoot}${msg}`;
        }

        if (Laravel.NotAvailableError.isInstance(input)) {
            return input.data.message || 'Laravel integration not available';
        }

        if (NamedError.Unknown.isInstance(input)) {
            return input.data.message;
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
     * Uses toObject() for NamedErrors, extracts useful info from regular Errors.
     */
    export function toObject(input: unknown): Record<string, unknown> {
        if (input instanceof NamedError) {
            return input.toObject();
        }

        // Effect Schema tagged errors: own enumerable props are `_tag` + fields.
        if (input instanceof Error && '_tag' in input && typeof input._tag === 'string') {
            const { _tag, ...fields } = { ...(input as Error & { _tag: string }) };
            return { name: _tag, data: fields };
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
