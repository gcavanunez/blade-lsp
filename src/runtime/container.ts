/**
 * Service container — typed accessor for all Effect-managed services.
 *
 * After the ManagedRuntime is built from layers, services are extracted
 * once into this container. All application code reads from here instead
 * of scattered module-level globals.
 *
 * This is the single source of truth for all singleton state.
 */

import { Effect, Layer, ManagedRuntime, MutableRef, Schema, Semaphore } from 'effect';
import { createConnection, TextDocuments, ProposedFeatures } from 'vscode-languageserver/node';
import type { Connection } from 'vscode-languageserver/node';
import type { TextDocuments as TextDocumentsType } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ParserTypes } from '../parser/types';
import { BladeParser } from '../parser';
import type { LaravelContext } from '../laravel/context';
import type { Laravel } from '../laravel/index';
import type { Server } from '../server';
import { Log } from '../utils/log';
import { Progress } from '../utils/progress';
import {
    ConnectionService,
    DocumentsService,
    ParserService,
    LoggerService,
    ProgressService,
    SettingsService,
    WorkspaceRootService,
    TreeCacheService,
    DocumentSourceCacheService,
    LaravelStateService,
    WatchCapabilityService,
    ParserRuntimeService,
    LaravelInitLockService,
    LaravelRefreshResultService,
} from './services';
import type { ParserApi, ProgressApi } from './services';

export namespace Container {
    export class NotInitializedError extends Schema.TaggedErrorClass<NotInitializedError>()(
        'ContainerNotInitializedError',
        { message: Schema.String },
    ) {}

    export interface Services {
        readonly connection: Connection;
        readonly documents: TextDocumentsType<TextDocument>;
        readonly parser: ParserApi;
        readonly logger: Log.Logger;
        readonly progress: ProgressApi;
        readonly settings: MutableRef.MutableRef<Server.Settings>;
        readonly workspaceRoot: MutableRef.MutableRef<string | null>;
        readonly treeCache: Map<string, BladeParser.Tree>;
        readonly documentSourceCache: Map<string, string>;
        readonly laravelState: MutableRef.MutableRef<LaravelContext.State | null>;
        readonly watchCapability: MutableRef.MutableRef<boolean>;
        readonly parserRuntime: MutableRef.MutableRef<ParserTypes.Runtime | null>;
        readonly laravelInitLock: Semaphore.Semaphore;
        readonly laravelRefreshResult: MutableRef.MutableRef<Laravel.RefreshResult | null>;
    }

    let container: Services | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let runtime: ManagedRuntime.ManagedRuntime<any, any> | null = null;

    /**
     * Get the active service container.
     * @throws if the container has not been initialized.
     */
    export function get(): Services {
        if (!container) {
            throw new NotInitializedError({
                message: 'Service container not initialized. Call Container.init() first.',
            });
        }
        return container;
    }

    /**
     * Initialize the container with pre-built services.
     * Primarily used by tests to install stub containers.
     */
    export function init(services: Services): void {
        container = services;
    }

    /**
     * Check if the container has been initialized.
     */
    export function isReady(): boolean {
        return container !== null;
    }

    /**
     * Build the process-scoped layer.
     *
     * Accepts an optional external `Connection` (useful for testing with
     * in-memory transports) — otherwise creates the default stdio connection.
     *
     * An internally-created connection is owned by the runtime: it is
     * acquired when the layer builds and disposed when the runtime is
     * disposed (`Container.dispose()`). External connections are not owned —
     * their lifecycle belongs to the caller.
     */
    function makeProcessLayer(externalConnection?: Connection) {
        const ConnectionLive = externalConnection
            ? Layer.succeed(ConnectionService, externalConnection)
            : Layer.effect(
                  ConnectionService,
                  Effect.acquireRelease(
                      Effect.sync(() => createConnection(ProposedFeatures.all)),
                      (conn) => Effect.sync(() => conn.dispose()),
                  ),
              );

        const DocumentsLive = Layer.succeed(DocumentsService, new TextDocuments(TextDocument));

        const ParserLive = Layer.succeed(ParserService, {
            initialize: () => BladeParser.initialize(),
            parse: (source: string, previousTree?: BladeParser.Tree) => BladeParser.parse(source, previousTree),
        } satisfies ParserApi);

        const LoggerLive = Layer.succeed(LoggerService, Log.create({ service: 'blade-lsp' }));

        const ProgressLive = Layer.succeed(ProgressService, {
            begin: (title: string, message?: string) => Progress.begin(title, message),
        } satisfies ProgressApi);

        return Layer.mergeAll(ConnectionLive, DocumentsLive, ParserLive, LoggerLive, ProgressLive);
    }

    /**
     * Build the workspace-scoped layer.
     * Each service starts with a sensible default (null, empty map, etc.).
     */
    function makeWorkspaceLayer() {
        return Layer.mergeAll(
            Layer.succeed(SettingsService, MutableRef.make<Server.Settings>({})),
            Layer.succeed(WorkspaceRootService, MutableRef.make<string | null>(null)),
            Layer.succeed(TreeCacheService, new Map<string, BladeParser.Tree>()),
            Layer.succeed(DocumentSourceCacheService, new Map<string, string>()),
            Layer.succeed(LaravelStateService, MutableRef.make<LaravelContext.State | null>(null)),
            Layer.succeed(WatchCapabilityService, MutableRef.make<boolean>(false)),
            Layer.succeed(ParserRuntimeService, MutableRef.make<ParserTypes.Runtime | null>(null)),
            Layer.succeed(LaravelInitLockService, Semaphore.makeUnsafe(1)),
            Layer.succeed(LaravelRefreshResultService, MutableRef.make<Laravel.RefreshResult | null>(null)),
        );
    }

    /**
     * Build the Effect runtime from layers, extract all services into the
     * container, and make them available for the rest of the application.
     *
     * Call once during server startup.
     *
     * @param externalConnection Optional LSP connection (for testing).
     */
    export function build(externalConnection?: Connection): void {
        const layer = Layer.merge(makeProcessLayer(externalConnection), makeWorkspaceLayer());
        runtime = ManagedRuntime.make(layer);

        init({
            connection: runtime.runSync(ConnectionService),
            documents: runtime.runSync(DocumentsService),
            parser: runtime.runSync(ParserService),
            logger: runtime.runSync(LoggerService),
            progress: runtime.runSync(ProgressService),
            settings: runtime.runSync(SettingsService),
            workspaceRoot: runtime.runSync(WorkspaceRootService),
            treeCache: runtime.runSync(TreeCacheService),
            documentSourceCache: runtime.runSync(DocumentSourceCacheService),
            laravelState: runtime.runSync(LaravelStateService),
            watchCapability: runtime.runSync(WatchCapabilityService),
            parserRuntime: runtime.runSync(ParserRuntimeService),
            laravelInitLock: runtime.runSync(LaravelInitLockService),
            laravelRefreshResult: runtime.runSync(LaravelRefreshResultService),
        });
    }

    /**
     * Tear down the runtime and clear the container.
     * Used between test runs for isolation.
     */
    export async function dispose(): Promise<void> {
        const currentRuntime = runtime;

        container = null;
        runtime = null;

        if (currentRuntime) {
            await currentRuntime.dispose();
        }
    }
}
