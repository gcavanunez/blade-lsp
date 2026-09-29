import { Schema } from 'effect';

/**
 * Fallback error for unknown/unexpected failures.
 *
 * Domain errors are `Schema.TaggedErrorClass` classes defined next to the
 * code that fails (see `PhpRunner`, `Views.RefreshError`, etc.). Use this
 * only when no typed error applies.
 */
export class UnknownError extends Schema.TaggedErrorClass<UnknownError>()('UnknownError', {
    message: Schema.String,
}) {}
