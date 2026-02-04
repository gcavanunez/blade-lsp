import { NamedError } from './error';
import { PhpRunner } from '../laravel/php-runner';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { Directives } from '../laravel/directives';
import { Laravel } from '../laravel';

/**
 * Format an error for user-facing display.
 * Returns a human-readable message for known errors, or undefined for unknown errors.
 *
 * Usage:
 * ```ts
 * const formatted = FormatError(err)
 * if (formatted) {
 *   conn.console.error(formatted)
 * } else {
 *   conn.console.error(`Unexpected error: ${err}`)
 * }
 * ```
 */
export function FormatError(input: unknown): string | undefined {
  // ─── PhpRunner Errors ────────────────────────────────────────────────────

  if (PhpRunner.ScriptNotFoundError.isInstance(input)) {
    return `PHP script '${input.data.script}' not found at ${input.data.path}`
  }

  if (PhpRunner.VendorDirError.isInstance(input)) {
    return `Failed to create vendor directory: ${input.data.message}`
  }

  if (PhpRunner.WriteError.isInstance(input)) {
    return `Failed to write PHP script: ${input.data.message}`
  }

  if (PhpRunner.TimeoutError.isInstance(input)) {
    return `PHP script '${input.data.scriptName}' timed out after ${input.data.timeoutMs}ms`
  }

  if (PhpRunner.StartupError.isInstance(input)) {
    return `Laravel failed to start: ${input.data.message}`
  }

  if (PhpRunner.OutputError.isInstance(input)) {
    return `Invalid PHP output: ${input.data.message}`
  }

  if (PhpRunner.ParseError.isInstance(input)) {
    return `Failed to parse PHP output: ${input.data.message}`
  }

  if (PhpRunner.SpawnError.isInstance(input)) {
    return `Failed to run PHP command '${input.data.command}': ${input.data.message}`
  }

  // ─── Views Errors ────────────────────────────────────────────────────────

  if (Views.RefreshError.isInstance(input)) {
    return `Failed to refresh views: ${input.data.message}`
  }

  if (Views.NotFoundError.isInstance(input)) {
    return `View '${input.data.key}' not found`
  }

  // ─── Components Errors ───────────────────────────────────────────────────

  if (Components.RefreshError.isInstance(input)) {
    return `Failed to refresh components: ${input.data.message}`
  }

  if (Components.NotFoundError.isInstance(input)) {
    return `Component '${input.data.key}' not found`
  }

  // ─── Directives Errors ───────────────────────────────────────────────────

  if (Directives.RefreshError.isInstance(input)) {
    return `Failed to refresh directives: ${input.data.message}`
  }

  if (Directives.NotFoundError.isInstance(input)) {
    return `Directive '${input.data.name}' not found`
  }

  // ─── Laravel Errors ──────────────────────────────────────────────────────

  if (Laravel.NotDetectedError.isInstance(input)) {
    return `No Laravel project detected in ${input.data.workspaceRoot}`
  }

  if (Laravel.ValidationError.isInstance(input)) {
    const msg = input.data.message ? `: ${input.data.message}` : ''
    return `Laravel project validation failed at ${input.data.projectRoot}${msg}`
  }

  if (Laravel.NotAvailableError.isInstance(input)) {
    return input.data.message || 'Laravel integration not available'
  }

  // ─── Unknown NamedError ──────────────────────────────────────────────────

  if (NamedError.Unknown.isInstance(input)) {
    return input.data.message
  }

  // ─── Fallback ────────────────────────────────────────────────────────────

  // Return undefined for unknown errors - caller decides how to handle
  return undefined
}

/**
 * Format an error for logging (includes more detail than user-facing).
 * Always returns a string.
 */
export function FormatErrorForLog(input: unknown): string {
  const formatted = FormatError(input)
  if (formatted) return formatted

  if (input instanceof Error) {
    return input.stack || input.message
  }

  return String(input)
}

/**
 * Convert an error to a structured object for logging.
 * Uses toObject() for NamedErrors, extracts useful info from regular Errors.
 */
export function ErrorToObject(input: unknown): Record<string, unknown> {
  if (input instanceof NamedError) {
    return input.toObject()
  }

  if (input instanceof Error) {
    return {
      name: input.name,
      message: input.message,
      stack: input.stack,
      cause: input.cause ? ErrorToObject(input.cause) : undefined,
    }
  }

  return { message: String(input) }
}
