import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    CompletionTriggerKind,
    createProtocolConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type CompletionContext,
    type CompletionItem,
    type CompletionList,
    type Hover,
    type Location,
    type Position,
} from 'vscode-languageserver/node';

export namespace PhpBridgeBackend {
    const execFileAsync = promisify(execFile);
    type ProgressToken = string | number;
    type ReadyCallback = () => void;

    export type BackendName = 'intelephense' | 'phpactor';

    export interface ShadowDocumentTransport {
        uri: string;
        version: number;
        text: string;
    }

    export interface BackendConfig {
        backendName: BackendName;
        command: string[];
        workspaceRoot: string;
        initializationOptions?: Record<string, unknown>;
        settings?: {
            intelephense?: {
                globalStoragePath?: string;
                storagePath?: string;
                client?: {
                    autoCloseDocCommentDoSuggest?: boolean;
                };
                files?: {
                    maxSize?: number;
                };
            };
        };
        logger?: {
            log(message: string): void;
            error(message: string): void;
        };
    }

    export interface Client {
        start(): Promise<void>;
        waitForReady(timeoutMs?: number): Promise<boolean>;
        onReady(callback: () => void): void;
        close(uri: string): Promise<void>;
        openOrUpdate(document: ShadowDocumentTransport): Promise<void>;
        /** Close and re-open a document so the backend fully re-analyzes it.
         *  Useful after indexing completes — some backends (intelephense) don't
         *  re-analyze files on `didChange` if they were opened pre-index. */
        reopen(document: ShadowDocumentTransport): Promise<void>;
        hover(uri: string, position: Position): Promise<Hover | null>;
        definition(uri: string, position: Position): Promise<Location | Location[] | null>;
        completion(
            uri: string,
            position: Position,
            context?: CompletionContext,
        ): Promise<CompletionItem[] | CompletionList | null>;
        resolveCompletion(item: CompletionItem): Promise<CompletionItem | null>;
        shutdown(): Promise<void>;
    }

    interface BackendSession {
        processRef: ChildProcessWithoutNullStreams;
        connection: ReturnType<typeof createProtocolConnection>;
        openVersions: Map<string, number>;
        readyCallbacks: ReadyCallback[];
        readiness: ReadinessState;
        indexingLifecycle: 'unknown' | 'started' | 'ended';
    }

    type ReadinessState =
        | { kind: 'awaiting-index-signal' }
        | { kind: 'indexing-running'; progressTokens: Set<ProgressToken> }
        | { kind: 'indexing-finishing'; progressTokens: Set<ProgressToken> }
        | { kind: 'ready' }
        | { kind: 'degraded'; reason: string };

    type ClientState =
        | { kind: 'idle' }
        | { kind: 'starting'; promise: Promise<BackendSession> }
        | { kind: 'running'; session: BackendSession }
        | { kind: 'stopping'; promise: Promise<void> };

    function workspaceUri(workspaceRoot: string): string {
        const normalized = workspaceRoot.split(path.sep).join('/');
        return `file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
    }

    export function resolveDefaultCommand(backendName: BackendName): string[] {
        const binary = backendName === 'phpactor' ? 'phpactor' : 'intelephense';
        const args = backendName === 'phpactor' ? ['language-server'] : ['--stdio'];

        // Check Mason bin path first — Mason installs LSP servers here via nvim
        const masonBin = path.join(os.homedir(), '.local', 'share', 'nvim', 'mason', 'bin', binary);
        if (existsSync(masonBin)) {
            return [masonBin, ...args];
        }

        // Fall back to bare command name (relies on $PATH)
        return [binary, ...args];
    }

    function expandPhpactorTokens(value: string, tokens: Record<string, string>): string {
        let result = value;
        for (const [token, replacement] of Object.entries(tokens)) {
            result = result.replaceAll(token, replacement);
        }
        return result;
    }

    async function preparePhpactorCacheDirectories(config: BackendConfig): Promise<void> {
        const [command] = config.command;
        try {
            const { stdout } = await execFileAsync(command, ['config:dump'], {
                cwd: config.workspaceRoot,
                env: process.env,
                maxBuffer: 10 * 1024 * 1024,
            });

            const projectIdMatch = stdout.match(/%project_id%:\s*(.+)/);
            const cacheMatch = stdout.match(/%cache%:\s*(.+)/);
            if (!projectIdMatch || !cacheMatch) {
                return;
            }

            const jsonStart = stdout.indexOf('{');
            if (jsonStart === -1) {
                return;
            }

            const configDump = JSON.parse(stdout.slice(jsonStart)) as Record<string, unknown>;
            const indexPath =
                typeof configDump['indexer.index_path'] === 'string' ? configDump['indexer.index_path'] : null;
            const worseReflectionPath =
                typeof configDump['worse_reflection.cache_dir'] === 'string'
                    ? configDump['worse_reflection.cache_dir']
                    : null;

            const tokens = {
                '%project_id%': projectIdMatch[1].trim(),
                '%cache%': cacheMatch[1].trim(),
            };

            const directories = [
                indexPath ? expandPhpactorTokens(indexPath, tokens) : null,
                worseReflectionPath ? expandPhpactorTokens(worseReflectionPath, tokens) : null,
            ].filter((value): value is string => !!value);

            for (const directory of directories) {
                await mkdir(directory, { recursive: true });
                config.logger?.log(`[php-bridge:${config.backendName}] prepared cache dir ${directory}`);
            }
        } catch (error) {
            config.logger?.error(`[php-bridge:${config.backendName}] cache prep failed: ${String(error)}`);
        }
    }

    export function createLspClient(config: BackendConfig): Client {
        let clientState: ClientState = { kind: 'idle' };
        const pendingReadyCallbacks: ReadyCallback[] = [];

        function isReadyState(readiness: ReadinessState): boolean {
            return readiness.kind === 'ready' || readiness.kind === 'degraded';
        }

        function flushReadyCallbacks(session: BackendSession): void {
            const count = session.readyCallbacks.length;
            for (const callback of session.readyCallbacks.splice(0)) {
                callback();
            }
            if (count > 0) {
                config.logger?.log(`[php-bridge:${config.backendName}] fired ${count} ready callbacks`);
            }
        }

        function transitionToReady(session: BackendSession): void {
            if (isReadyState(session.readiness)) {
                return;
            }

            session.readiness = { kind: 'ready' };
            flushReadyCallbacks(session);
        }

        function transitionToDegraded(session: BackendSession, reason: string): void {
            session.readiness = { kind: 'degraded', reason };
            flushReadyCallbacks(session);
        }

        function handleIndexingStarted(session: BackendSession): void {
            session.indexingLifecycle = 'started';

            switch (session.readiness.kind) {
                case 'awaiting-index-signal':
                    session.readiness = { kind: 'indexing-running', progressTokens: new Set<ProgressToken>() };
                    return;
                case 'indexing-finishing':
                    session.readiness = {
                        kind: 'indexing-running',
                        progressTokens: new Set(session.readiness.progressTokens),
                    };
                    return;
                case 'indexing-running':
                case 'ready':
                case 'degraded':
                    return;
            }
        }

        function handleIndexingEnded(session: BackendSession): void {
            session.indexingLifecycle = 'ended';

            switch (session.readiness.kind) {
                case 'awaiting-index-signal':
                    transitionToReady(session);
                    return;
                case 'indexing-running':
                    if (session.readiness.progressTokens.size === 0) {
                        transitionToReady(session);
                        return;
                    }

                    session.readiness = {
                        kind: 'indexing-finishing',
                        progressTokens: new Set(session.readiness.progressTokens),
                    };
                    return;
                case 'indexing-finishing':
                    if (session.readiness.progressTokens.size === 0) {
                        transitionToReady(session);
                    }
                    return;
                case 'ready':
                case 'degraded':
                    return;
            }
        }

        function handleProgressBegin(session: BackendSession, token: ProgressToken): void {
            switch (session.readiness.kind) {
                case 'awaiting-index-signal':
                    session.readiness = { kind: 'indexing-running', progressTokens: new Set<ProgressToken>([token]) };
                    return;
                case 'indexing-running':
                    session.readiness.progressTokens.add(token);
                    return;
                case 'indexing-finishing': {
                    const progressTokens = new Set(session.readiness.progressTokens);
                    progressTokens.add(token);
                    session.readiness = { kind: 'indexing-running', progressTokens };
                    return;
                }
                case 'ready':
                case 'degraded':
                    return;
            }
        }

        function handleProgressEnd(session: BackendSession, token: ProgressToken): void {
            switch (session.readiness.kind) {
                case 'indexing-running':
                case 'indexing-finishing':
                    session.readiness.progressTokens.delete(token);
                    if (session.readiness.progressTokens.size === 0 && session.indexingLifecycle !== 'started') {
                        transitionToReady(session);
                        return;
                    }
                    if (
                        session.readiness.kind === 'indexing-finishing' &&
                        session.readiness.progressTokens.size === 0
                    ) {
                        transitionToReady(session);
                    }
                    return;
                case 'awaiting-index-signal':
                case 'ready':
                case 'degraded':
                    return;
            }
        }

        function registerReadyCallback(session: BackendSession, callback: ReadyCallback): void {
            if (isReadyState(session.readiness)) {
                callback();
                return;
            }

            session.readyCallbacks.push(callback);
        }

        function getClientState(): ClientState {
            return clientState;
        }

        function getConfiguration() {
            return config.settings ?? {};
        }

        function getConfigurationValue(section?: string): unknown {
            if (!section) {
                return getConfiguration();
            }

            return section.split('.').reduce<unknown>((current, key) => {
                if (!current || typeof current !== 'object') {
                    return undefined;
                }
                return (current as Record<string, unknown>)[key];
            }, getConfiguration());
        }

        async function startSession(): Promise<BackendSession> {
            const [command, ...args] = config.command;
            let processRef: ChildProcessWithoutNullStreams | null = null;
            let connection: ReturnType<typeof createProtocolConnection> | null = null;

            if (config.backendName === 'phpactor') {
                await preparePhpactorCacheDirectories(config);
            }
            config.logger?.log(`[php-bridge:${config.backendName}] spawning backend: ${[command, ...args].join(' ')}`);

            try {
                processRef = spawn(command, args, {
                    cwd: config.workspaceRoot,
                    stdio: 'pipe',
                });

                const session: BackendSession = {
                    processRef,
                    connection: createProtocolConnection(
                        new StreamMessageReader(processRef.stdout),
                        new StreamMessageWriter(processRef.stdin),
                    ),
                    openVersions: new Map<string, number>(),
                    readyCallbacks: pendingReadyCallbacks.splice(0),
                    readiness: { kind: 'awaiting-index-signal' },
                    indexingLifecycle: 'unknown',
                };
                connection = session.connection;

                processRef.stderr.on('data', (chunk) => {
                    const text = chunk.toString().trim();
                    if (text) {
                        config.logger?.error(`[php-bridge:${config.backendName}] stderr: ${text}`);
                    }
                });
                processRef.on('exit', (code, signal) => {
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] exited code=${String(code)} signal=${String(signal)}`,
                    );
                });
                processRef.on('error', (error) => {
                    config.logger?.error(`[php-bridge:${config.backendName}] process error: ${String(error)}`);
                });

                connection.onRequest(
                    'workspace/configuration',
                    (params: { items?: Array<{ section?: string }> } | undefined) =>
                        (params?.items ?? []).map((item) => getConfigurationValue(item.section)),
                );
                connection.onRequest('window/workDoneProgress/create', () => {
                    return null;
                });
                connection.onNotification('indexingStarted', () => {
                    handleIndexingStarted(session);
                    config.logger?.log(`[php-bridge:${config.backendName}] indexing started`);
                });
                connection.onNotification('indexingEnded', () => {
                    handleIndexingEnded(session);
                    config.logger?.log(`[php-bridge:${config.backendName}] indexing ended`);
                });
                connection.onNotification(
                    '$/progress',
                    (params: {
                        token: string | number;
                        value: {
                            kind: 'begin' | 'report' | 'end';
                            title?: string;
                            message?: string;
                            percentage?: number;
                        };
                    }) => {
                        if (params.value.kind === 'begin') {
                            handleProgressBegin(session, params.token);
                            config.logger?.log(
                                `[php-bridge:${config.backendName}] progress begin: ${params.value.title ?? ''} (${String(params.token)})`,
                            );
                        } else if (params.value.kind === 'end') {
                            handleProgressEnd(session, params.token);
                            config.logger?.log(
                                `[php-bridge:${config.backendName}] progress end: (${String(params.token)})`,
                            );
                        }
                    },
                );
                // Catch-all for any unhandled requests from the backend (e.g.
                // window/showMessageRequest).  Return null so the backend doesn't hang.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                (connection as any).onRequest((method: string, params: unknown) => {
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] unhandled request: ${method} ${JSON.stringify(params)?.slice(0, 300)}`,
                    );
                    return null;
                });
                // Catch-all for unhandled notifications.  Detects indexer crashes
                // so we can treat them as degraded-ready rather than hanging forever.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                (connection as any).onNotification((method: string, params: unknown) => {
                    if (
                        method === 'window/showMessage' &&
                        typeof params === 'object' &&
                        params !== null &&
                        'message' in params &&
                        typeof (params as { message: unknown }).message === 'string' &&
                        (params as { message: string }).message.includes('Error in service "indexer"')
                    ) {
                        config.logger?.error(
                            `[php-bridge:${config.backendName}] indexer service crashed — treating as degraded ready`,
                        );
                        transitionToDegraded(session, 'indexer-crash');
                    }
                });
                connection.listen();

                const initializeResult = await connection.sendRequest('initialize', {
                    processId: process.pid,
                    rootUri: workspaceUri(config.workspaceRoot),
                    capabilities: {
                        window: {
                            workDoneProgress: true,
                        },
                        workspace: {
                            configuration: true,
                            workspaceFolders: true,
                        },
                        textDocument: {
                            completion: {
                                completionItem: {
                                    snippetSupport: true,
                                    documentationFormat: ['markdown', 'plaintext'],
                                    insertReplaceSupport: true,
                                    labelDetailsSupport: true,
                                    resolveSupport: {
                                        properties: [
                                            'documentation',
                                            'detail',
                                            'additionalTextEdits',
                                            'command',
                                            'data',
                                        ],
                                    },
                                },
                                completionList: {
                                    itemDefaults: [
                                        'commitCharacters',
                                        'editRange',
                                        'insertTextFormat',
                                        'insertTextMode',
                                        'data',
                                    ],
                                },
                                contextSupport: true,
                            },
                            hover: {
                                contentFormat: ['markdown', 'plaintext'],
                            },
                        },
                    },
                    initializationOptions: config.initializationOptions ?? {},
                    workspaceFolders: [
                        {
                            uri: workspaceUri(config.workspaceRoot),
                            name: path.basename(config.workspaceRoot),
                        },
                    ],
                });
                config.logger?.log(
                    `[php-bridge:${config.backendName}] initialize result: ${JSON.stringify(initializeResult)}`,
                );
                connection.sendNotification('initialized', {});
                connection.sendNotification('workspace/didChangeConfiguration', {
                    settings: getConfiguration(),
                });

                if (config.backendName === 'intelephense') {
                    try {
                        const result = await connection.sendRequest('workspace/executeCommand', {
                            command: 'intelephense.index.workspace',
                        });
                        config.logger?.log(
                            `[php-bridge:${config.backendName}] index.workspace result: ${JSON.stringify(result)}`,
                        );
                    } catch (error) {
                        config.logger?.error(
                            `[php-bridge:${config.backendName}] index.workspace failed: ${String(error)}`,
                        );
                    }
                }

                return session;
            } catch (error) {
                connection?.dispose();
                if (processRef && processRef.exitCode === null && !processRef.killed) {
                    processRef.kill();
                }
                throw error;
            }
        }

        async function ensureStarted(): Promise<BackendSession> {
            while (true) {
                const current = clientState;

                switch (current.kind) {
                    case 'running':
                        return current.session;
                    case 'starting': {
                        const session = await current.promise;
                        if (clientState.kind === 'stopping') {
                            await clientState.promise;
                            continue;
                        }
                        return session;
                    }
                    case 'stopping':
                        await current.promise;
                        continue;
                    case 'idle': {
                        const startPromise = startSession().then(
                            (session) => {
                                if (clientState.kind === 'starting' && clientState.promise === startPromise) {
                                    clientState = { kind: 'running', session };
                                }
                                return session;
                            },
                            (error: unknown) => {
                                if (clientState.kind === 'starting' && clientState.promise === startPromise) {
                                    clientState = { kind: 'idle' };
                                }
                                throw error;
                            },
                        );

                        clientState = { kind: 'starting', promise: startPromise };
                        const session = await startPromise;
                        const nextState = getClientState();
                        if (nextState.kind === 'stopping') {
                            await nextState.promise;
                            continue;
                        }
                        return session;
                    }
                }
            }
        }

        async function shutdownSession(session: BackendSession): Promise<void> {
            session.readyCallbacks.length = 0;

            try {
                await session.connection.sendRequest('shutdown');
            } catch {
                // Ignore shutdown transport failures and continue cleanup.
            }

            if (session.processRef.exitCode === null && !session.processRef.killed) {
                session.processRef.kill();
            }

            session.connection.dispose();
            session.openVersions.clear();
        }

        return {
            async start() {
                await ensureStarted();
            },

            onReady(callback: () => void) {
                switch (clientState.kind) {
                    case 'running':
                        registerReadyCallback(clientState.session, callback);
                        return;
                    case 'starting':
                    case 'idle':
                    case 'stopping':
                        pendingReadyCallbacks.push(callback);
                        return;
                }
            },

            async waitForReady(timeoutMs = 180_000) {
                const session = await ensureStarted();

                if (isReadyState(session.readiness)) {
                    return true;
                }

                if (session.readiness.kind === 'awaiting-index-signal') {
                    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
                    if (session.readiness.kind === 'awaiting-index-signal') {
                        config.logger?.log(`[php-bridge:${config.backendName}] no indexing detected, assuming ready`);
                        transitionToReady(session);
                        return true;
                    }
                }

                return new Promise<boolean>((resolve) => {
                    const onReady = () => {
                        clearTimeout(timer);
                        config.logger?.log(`[php-bridge:${config.backendName}] indexer ready`);
                        resolve(true);
                    };

                    const timer = setTimeout(() => {
                        const index = session.readyCallbacks.indexOf(onReady);
                        if (index >= 0) {
                            session.readyCallbacks.splice(index, 1);
                        }
                        config.logger?.log(
                            `[php-bridge:${config.backendName}] waitForReady timed out after ${timeoutMs}ms`,
                        );
                        resolve(false);
                    }, timeoutMs);

                    registerReadyCallback(session, onReady);

                    if (isReadyState(session.readiness)) {
                        clearTimeout(timer);
                        const index = session.readyCallbacks.indexOf(onReady);
                        if (index >= 0) {
                            session.readyCallbacks.splice(index, 1);
                        }
                        resolve(true);
                    }
                });
            },

            async openOrUpdate(document) {
                const session = await ensureStarted();

                const knownVersion = session.openVersions.get(document.uri);
                if (knownVersion === undefined) {
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] didOpen ${document.uri} v${document.version}`,
                    );
                    session.connection.sendNotification('textDocument/didOpen', {
                        textDocument: {
                            uri: document.uri,
                            languageId: 'php',
                            version: document.version,
                            text: document.text,
                        },
                    });
                } else {
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] didChange ${document.uri} v${document.version}`,
                    );
                    session.connection.sendNotification('textDocument/didChange', {
                        textDocument: {
                            uri: document.uri,
                            version: document.version,
                        },
                        contentChanges: [{ text: document.text }],
                    });
                }

                session.openVersions.set(document.uri, document.version);
            },

            async close(uri) {
                switch (clientState.kind) {
                    case 'idle':
                    case 'stopping':
                        return;
                    case 'starting': {
                        const session = await clientState.promise.catch(() => null);
                        if (!session || !session.openVersions.has(uri)) {
                            return;
                        }

                        config.logger?.log(`[php-bridge:${config.backendName}] didClose ${uri}`);
                        session.connection.sendNotification('textDocument/didClose', {
                            textDocument: { uri },
                        });
                        session.openVersions.delete(uri);
                        return;
                    }
                    case 'running':
                        if (!clientState.session.openVersions.has(uri)) {
                            return;
                        }

                        config.logger?.log(`[php-bridge:${config.backendName}] didClose ${uri}`);
                        clientState.session.connection.sendNotification('textDocument/didClose', {
                            textDocument: { uri },
                        });
                        clientState.session.openVersions.delete(uri);
                        return;
                }
            },

            async reopen(document) {
                const session = await ensureStarted();

                if (session.openVersions.has(document.uri)) {
                    config.logger?.log(`[php-bridge:${config.backendName}] didClose (reopen) ${document.uri}`);
                    session.connection.sendNotification('textDocument/didClose', {
                        textDocument: { uri: document.uri },
                    });
                    session.openVersions.delete(document.uri);
                }

                config.logger?.log(
                    `[php-bridge:${config.backendName}] didOpen (reopen) ${document.uri} v${document.version}`,
                );
                session.connection.sendNotification('textDocument/didOpen', {
                    textDocument: {
                        uri: document.uri,
                        languageId: 'php',
                        version: document.version,
                        text: document.text,
                    },
                });
                session.openVersions.set(document.uri, document.version);
            },

            async hover(uri, position) {
                const session = await ensureStarted();
                return (await session.connection.sendRequest('textDocument/hover', {
                    textDocument: { uri },
                    position,
                })) as Hover | null;
            },

            async definition(uri, position) {
                const session = await ensureStarted();

                const result = (await session.connection.sendRequest('textDocument/definition', {
                    textDocument: { uri },
                    position,
                })) as Location | Location[] | null;
                config.logger?.log(
                    `[php-bridge:${config.backendName}] definition ${uri} @ ${position.line}:${position.character} -> ${JSON.stringify(result)}`,
                );
                return result;
            },

            async completion(uri, position, context) {
                const session = await ensureStarted();
                if (session.readiness.kind === 'indexing-running' || session.readiness.kind === 'indexing-finishing') {
                    config.logger?.log(`[php-bridge:${config.backendName}] completion requested while indexing`);
                }

                const result = (await session.connection.sendRequest('textDocument/completion', {
                    textDocument: { uri },
                    position,
                    context: context ?? {
                        triggerKind: CompletionTriggerKind.Invoked,
                    },
                })) as CompletionItem[] | CompletionList | null;
                const items = Array.isArray(result) ? result : (result?.items ?? []);
                config.logger?.log(
                    `[php-bridge:${config.backendName}] completion ${uri} @ ${position.line}:${position.character} -> ${items.length} items (${items
                        .slice(0, 10)
                        .map((item) => item.label)
                        .join(', ')})`,
                );
                return result;
            },

            async resolveCompletion(item) {
                const session = await ensureStarted();

                const result = (await session.connection.sendRequest(
                    'completionItem/resolve',
                    item,
                )) as CompletionItem | null;
                config.logger?.log(
                    `[php-bridge:${config.backendName}] resolveCompletion ${item.label} -> ${JSON.stringify({
                        textEdit: result && 'textEdit' in result ? result.textEdit : undefined,
                        additionalTextEdits: result?.additionalTextEdits,
                    })}`,
                );
                return result;
            },

            async shutdown() {
                while (true) {
                    const current = clientState;

                    switch (current.kind) {
                        case 'idle':
                            pendingReadyCallbacks.length = 0;
                            return;
                        case 'stopping':
                            await current.promise;
                            return;
                        case 'starting':
                        case 'running': {
                            let stopPromise: Promise<void>;
                            stopPromise = (async () => {
                                try {
                                    const session =
                                        current.kind === 'starting'
                                            ? await current.promise.catch(() => null)
                                            : current.session;
                                    if (session) {
                                        await shutdownSession(session);
                                    }
                                } finally {
                                    pendingReadyCallbacks.length = 0;
                                    clientState = { kind: 'idle' };
                                }
                            })();

                            clientState = { kind: 'stopping', promise: stopPromise };
                            await stopPromise;
                            return;
                        }
                    }
                }
            },
        };
    }
}
