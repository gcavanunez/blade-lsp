/**
 * Effect service definitions for blade-lsp.
 *
 * Each `Context.Service` key declares a named dependency that can be
 * provided via layers at startup and consumed anywhere in the Effect pipeline.
 *
 * Mutable workspace state uses Effect's `MutableRef<T>` — a synchronous
 * mutable cell. Effect owns the lifecycle (creation via Layer,
 * disposal via runtime teardown); the ref is just the container.
 *
 * Scope model:
 *   - Process scope: one per server process (connection, parser, logger, progress)
 *   - Workspace scope: one per opened root (settings, tree cache, laravel state)
 */

import { Context, MutableRef, Semaphore } from 'effect';
import type { Connection, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParserTypes } from '../parser/types';
import type { BladeParser } from '../parser';
import type { LaravelContext } from '../laravel/context';
import type { Laravel } from '../laravel/index';
import type { Server } from '../server';
import type { Log } from '../utils/log';

/**
 * The LSP connection singleton.
 */
export class ConnectionService extends Context.Service<ConnectionService, Connection>()('ConnectionService') {}

/**
 * The open-documents manager.
 */
export class DocumentsService extends Context.Service<DocumentsService, TextDocuments<TextDocument>>()(
    'DocumentsService',
) {}

/**
 * Parser facade — initialize + parse.
 */
export interface ParserApi {
    initialize(): Promise<void>;
    parse(source: string, previousTree?: BladeParser.Tree): BladeParser.Tree;
}

export class ParserService extends Context.Service<ParserService, ParserApi>()('ParserService') {}

/**
 * Structured logger.
 */
export class LoggerService extends Context.Service<LoggerService, Log.Logger>()('LoggerService') {}

/**
 * Progress reporting transport.
 */
export interface ProgressApi {
    begin(title: string, message?: string): Promise<ProgressHandle>;
}

export interface ProgressHandle {
    report(message: string, percentage?: number): void;
    done(message?: string): void;
}

export class ProgressService extends Context.Service<ProgressService, ProgressApi>()('ProgressService') {}

/**
 * Mutable reference to the server settings.
 */
export class SettingsService extends Context.Service<SettingsService, MutableRef.MutableRef<Server.Settings>>()(
    'SettingsService',
) {}

/**
 * Mutable reference to the workspace root path.
 */
export class WorkspaceRootService extends Context.Service<WorkspaceRootService, MutableRef.MutableRef<string | null>>()(
    'WorkspaceRootService',
) {}

/**
 * The tree-sitter parse tree cache (keyed by document URI).
 */
export class TreeCacheService extends Context.Service<TreeCacheService, Map<string, BladeParser.Tree>>()(
    'TreeCacheService',
) {}

/**
 * Last parsed document source per URI.
 */
export class DocumentSourceCacheService extends Context.Service<DocumentSourceCacheService, Map<string, string>>()(
    'DocumentSourceCacheService',
) {}

/**
 * Mutable reference to the Laravel context state.
 * `null` when no Laravel project is detected.
 */
export class LaravelStateService extends Context.Service<
    LaravelStateService,
    MutableRef.MutableRef<LaravelContext.State | null>
>()('LaravelStateService') {}

/**
 * Whether the client supports `didChangeWatchedFiles` dynamic registration.
 */
export class WatchCapabilityService extends Context.Service<WatchCapabilityService, MutableRef.MutableRef<boolean>>()(
    'WatchCapabilityService',
) {}

/**
 * Mutable reference to the active tree-sitter parser runtime.
 * `null` until `BladeParser.initialize()` is called.
 */
export class ParserRuntimeService extends Context.Service<
    ParserRuntimeService,
    MutableRef.MutableRef<ParserTypes.Runtime | null>
>()('ParserRuntimeService') {}

/**
 * Mutex guarding `Laravel.initialize()`.
 *
 * Concurrent callers queue on the single permit; once the winner completes,
 * queued callers observe the initialized context and return without
 * re-running the boot sequence.
 */
export class LaravelInitLockService extends Context.Service<LaravelInitLockService, Semaphore.Semaphore>()(
    'LaravelInitLockService',
) {}

/**
 * Mutable reference to the result of the last `Laravel.refreshAll()` call.
 * `null` until the first refresh completes.
 */
export class LaravelRefreshResultService extends Context.Service<
    LaravelRefreshResultService,
    MutableRef.MutableRef<Laravel.RefreshResult | null>
>()('LaravelRefreshResultService') {}
