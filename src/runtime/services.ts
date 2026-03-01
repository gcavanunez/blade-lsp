/**
 * Effect service definitions for blade-lsp.
 *
 * Each `Context.Tag` declares a named dependency that can be provided
 * via layers at startup and consumed anywhere in the Effect pipeline.
 *
 * Mutable workspace state uses Effect's `MutableRef<T>` — a synchronous
 * mutable cell. Effect owns the lifecycle (creation via Layer,
 * disposal via runtime teardown); the ref is just the container.
 *
 * Scope model:
 *   - Process scope: one per server process (connection, parser, logger, progress)
 *   - Workspace scope: one per opened root (settings, tree cache, laravel state)
 */

import { Context, MutableRef } from 'effect';
import type { Connection, TextDocuments } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParserTypes } from '../parser/types';
import type { BladeParser } from '../parser';
import type { LaravelContext } from '../laravel/context';
import type { Laravel } from '../laravel/index';
import type { Server } from '../server';
import type { Log } from '../utils/log';

export { MutableRef } from 'effect';

/**
 * The LSP connection singleton.
 */
export class ConnectionService extends Context.Tag('ConnectionService')<ConnectionService, Connection>() {}

/**
 * The open-documents manager.
 */
export class DocumentsService extends Context.Tag('DocumentsService')<
    DocumentsService,
    TextDocuments<TextDocument>
>() {}

/**
 * Parser facade — initialize + parse.
 */
export interface ParserApi {
    initialize(): Promise<void>;
    parse(source: string, previousTree?: BladeParser.Tree): BladeParser.Tree;
}

export class ParserService extends Context.Tag('ParserService')<ParserService, ParserApi>() {}

/**
 * Structured logger.
 */
export class LoggerService extends Context.Tag('LoggerService')<LoggerService, Log.Logger>() {}

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

export class ProgressService extends Context.Tag('ProgressService')<ProgressService, ProgressApi>() {}

/**
 * Mutable reference to the server settings.
 */
export class SettingsService extends Context.Tag('SettingsService')<
    SettingsService,
    MutableRef.MutableRef<Server.Settings>
>() {}

/**
 * Mutable reference to the workspace root path.
 */
export class WorkspaceRootService extends Context.Tag('WorkspaceRootService')<
    WorkspaceRootService,
    MutableRef.MutableRef<string | null>
>() {}

/**
 * The tree-sitter parse tree cache (keyed by document URI).
 */
export class TreeCacheService extends Context.Tag('TreeCacheService')<
    TreeCacheService,
    Map<string, BladeParser.Tree>
>() {}

/**
 * Last parsed document source per URI.
 */
export class DocumentSourceCacheService extends Context.Tag('DocumentSourceCacheService')<
    DocumentSourceCacheService,
    Map<string, string>
>() {}

/**
 * Mutable reference to the Laravel context state.
 * `null` when no Laravel project is detected.
 */
export class LaravelStateService extends Context.Tag('LaravelStateService')<
    LaravelStateService,
    MutableRef.MutableRef<LaravelContext.State | null>
>() {}

/**
 * Whether the client supports `didChangeWatchedFiles` dynamic registration.
 */
export class WatchCapabilityService extends Context.Tag('WatchCapabilityService')<
    WatchCapabilityService,
    MutableRef.MutableRef<boolean>
>() {}

/**
 * Mutable reference to the active tree-sitter parser runtime.
 * `null` until `BladeParser.initialize()` is called.
 */
export class ParserRuntimeService extends Context.Tag('ParserRuntimeService')<
    ParserRuntimeService,
    MutableRef.MutableRef<ParserTypes.Runtime | null>
>() {}

/**
 * Mutable reference to the in-flight Laravel initialization promise.
 * Acts as a mutex to prevent concurrent `Laravel.initialize()` calls.
 */
export class LaravelInitPromiseService extends Context.Tag('LaravelInitPromiseService')<
    LaravelInitPromiseService,
    MutableRef.MutableRef<Promise<boolean> | null>
>() {}

/**
 * Mutable reference to the result of the last `Laravel.refreshAll()` call.
 * `null` until the first refresh completes.
 */
export class LaravelRefreshResultService extends Context.Tag('LaravelRefreshResultService')<
    LaravelRefreshResultService,
    MutableRef.MutableRef<Laravel.RefreshResult | null>
>() {}
