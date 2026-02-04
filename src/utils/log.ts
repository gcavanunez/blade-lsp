import { NamedError } from './error';
import { defer } from './defer';

/**
 * Structured logging utility with tag support and timing.
 *
 * Usage:
 * ```ts
 * const log = Log.create({ service: "laravel" })
 * log.info("Initialized", { path: "/app" })
 * log.error("Failed", { error: new Error("oops") })
 *
 * // NamedErrors are automatically serialized with toObject()
 * log.error("Failed", { error: new PhpRunner.TimeoutError({ ... }) })
 *
 * // Timing with dispose
 * using _ = log.time("Loading views")
 * // ... work
 * // automatically logs completion with duration
 * ```
 */
export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  }

  let currentLevel: Level = "INFO"

  /**
   * Set the minimum log level.
   */
  export function setLevel(level: Level) {
    currentLevel = level
  }

  /**
   * Get the current log level.
   */
  export function getLevel(): Level {
    return currentLevel
  }

  function shouldLog(level: Level): boolean {
    return levelPriority[level] >= levelPriority[currentLevel]
  }

  export interface Logger {
    debug(message?: string, extra?: Record<string, unknown>): void
    info(message?: string, extra?: Record<string, unknown>): void
    warn(message?: string, extra?: Record<string, unknown>): void
    error(message?: string, extra?: Record<string, unknown>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, unknown>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()

  // Writer function - defaults to stderr, can be overridden
  let write = (msg: string) => {
    process.stderr.write(msg)
  }

  /**
   * Override the default writer (stderr).
   */
  export function setWriter(fn: (msg: string) => void) {
    write = fn
  }

  function formatError(error: Error, depth = 0): string {
    // Use toObject() for NamedErrors to get structured data
    if (error instanceof NamedError) {
      const obj = error.toObject()
      try {
        return JSON.stringify(obj)
      } catch {
        return `${obj.name}: ${JSON.stringify(obj.data)}`
      }
    }

    const result = error.message
    return error.cause instanceof Error && depth < 10
      ? result + " Caused by: " + formatError(error.cause, depth + 1)
      : result
  }

  function formatValue(value: unknown): string {
    // NamedErrors get special handling with toObject()
    if (value instanceof NamedError) {
      try {
        return JSON.stringify(value.toObject())
      } catch {
        return `${value.name}: ${value.message}`
      }
    }

    if (value instanceof Error) return formatError(value)

    if (typeof value === "object" && value !== null) {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  let last = Date.now()

  /**
   * Create a logger with optional tags.
   * Loggers with a `service` tag are cached and reused.
   */
  export function create(tags?: Record<string, unknown>): Logger {
    tags = tags ? { ...tags } : {}

    const service = tags["service"]
    if (typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function build(message?: string, extra?: Record<string, unknown>): string {
      const allTags = { ...tags, ...extra }
      const prefix = Object.entries(allTags)
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(" ")

      const now = new Date()
      const diff = now.getTime() - last
      last = now.getTime()

      const timestamp = now.toISOString().split(".")[0]
      return [timestamp, `+${diff}ms`, prefix, message].filter(Boolean).join(" ") + "\n"
    }

    const result: Logger = {
      debug(message?: string, extra?: Record<string, unknown>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
        }
      },
      info(message?: string, extra?: Record<string, unknown>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
        }
      },
      warn(message?: string, extra?: Record<string, unknown>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
        }
      },
      error(message?: string, extra?: Record<string, unknown>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
        }
      },
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },
      clone() {
        return create({ ...tags })
      },
      time(message: string, extra?: Record<string, unknown>) {
        const start = Date.now()
        result.info(message, { status: "started", ...extra })

        function stop() {
          result.info(message, {
            status: "completed",
            duration: `${Date.now() - start}ms`,
            ...extra,
          })
        }

        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (typeof service === "string") {
      loggers.set(service, result)
    }

    return result
  }

  /**
   * Default logger instance.
   */
  export const Default = create({ service: "default" })

  /**
   * Run a function with a temporary log level.
   * Level is automatically restored when the function returns (even on error).
   *
   * @example
   * ```ts
   * // Debug a specific operation
   * Log.withLevel('DEBUG', () => {
   *   doSomethingComplex();
   * });
   *
   * // Async version
   * await Log.withLevel('DEBUG', async () => {
   *   await doSomethingAsync();
   * });
   * ```
   */
  export function withLevel<T>(level: Level, fn: () => T): T {
    const oldLevel = currentLevel;
    setLevel(level);
    using _ = defer(() => setLevel(oldLevel));
    return fn();
  }
}
