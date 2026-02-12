#!/usr/bin/env node
import {
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionItem,
    Hover,
    Diagnostic,
    DiagnosticSeverity,
    MarkupKind,
    MessageType,
    Position,
    TextDocumentPositionParams,
    Location,
    DefinitionParams,
    Connection,
    DidChangeWatchedFilesNotification,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BladeParser } from './parser';
import { BladeDirectives } from './directives';
import { Laravel } from './laravel/index';
import { Directives } from './laravel/directives';
import { Views } from './laravel/views';
import { Components } from './laravel/components';
import { PhpEnvironment } from './laravel/php-environment';
import { FormatErrorForLog } from './utils/format-error';
import { Progress } from './utils/progress';
import { tryAsync } from './utils/try-async';
import { Completions } from './providers/completions';
import { Hovers } from './providers/hovers';
import { Definitions } from './providers/definitions';
import { Diagnostics } from './providers/diagnostics';
import { Watcher } from './watcher';
import { Container } from './runtime/container';
import { MutableRef } from 'effect';

export namespace Server {
    export interface Settings {
        // Command array to execute PHP (defaults to auto-detect if not provided)
        // Examples:
        //   - Local: ['php'] or ['/usr/bin/php']
        //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
        //   - Sail: ['./vendor/bin/sail', 'php']
        phpCommand?: string[];
        // Preferred PHP environment (e.g., 'sail', 'herd', 'docker').
        // If set, skips auto-detection and tries only this environment.
        phpEnvironment?: PhpEnvironment.Name;
        enableLaravelIntegration?: boolean;
        // Parser backend: 'wasm' (web-tree-sitter) or 'native' (node-gyp).
        // Defaults to 'wasm'. Use 'native' for local development with node-gyp bindings.
        parserBackend?: 'native' | 'wasm';
    }

    export function getWorkspaceRoot(): string | null {
        if (!Container.isReady()) return null;
        return MutableRef.get(Container.get().workspaceRoot);
    }

    /**
     * Collect custom directive completions from Laravel, excluding built-in directives.
     */
    function getCustomDirectiveCompletions(prefix: string): CompletionItem[] {
        if (!Laravel.isAvailable()) return [];

        const isSearch = prefix.length > 1; // '@fo' vs just '@'
        const directives = isSearch ? Directives.search(prefix.replace('@', '')) : Directives.getItems();

        const items: CompletionItem[] = [];
        for (const directive of directives) {
            if (!BladeDirectives.map.has(directive.name)) {
                items.push(Completions.createCustomDirectiveItem(directive, prefix));
            }
        }
        return items;
    }

    // Parse document and cache the tree
    function parseDocument(document: TextDocument): BladeParser.Tree {
        const tree = BladeParser.parse(document.getText());
        Container.get().treeCache.set(document.uri, tree);
        return tree;
    }

    const SEVERITY_MAP: Record<string, DiagnosticSeverity> = {
        error: DiagnosticSeverity.Error,
        warning: DiagnosticSeverity.Warning,
        info: DiagnosticSeverity.Information,
    };

    function mapDiagnosticSeverity(severity: string): DiagnosticSeverity {
        return SEVERITY_MAP[severity] ?? DiagnosticSeverity.Information;
    }

    const build = (externalConn?: Connection) => {
        // Build Effect runtime and extract all services into the container
        Container.build(externalConn);
        const { connection: conn, documents: docs, treeCache: cache } = Container.get();

        conn.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
            const c = Container.get();

            // Store workspace root for Laravel detection
            MutableRef.set(c.workspaceRoot, params.workspaceFolders?.at(0)?.uri?.replace('file://', '') ?? null);

            // Get initialization options (settings passed from client)
            const settings = (params.initializationOptions as Settings) ?? {};
            MutableRef.set(c.settings, settings);
            conn.console.log(`Settings received: ${JSON.stringify(settings)}`);

            // Detect client capability for file watching
            MutableRef.set(
                c.watchCapability,
                !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration,
            );

            // Detect client capability for progress reporting
            const supportsProgress = !!params.capabilities.window?.workDoneProgress;
            Progress.initialize(conn, supportsProgress);

            // Initialize the tree-sitter parser
            const backend = settings.parserBackend ?? 'native';
            const { error } = await tryAsync(() => BladeParser.initialize(backend));
            if (error) {
                conn.console.error(`Failed to initialize parser: ${FormatErrorForLog(error)}`);
            } else {
                conn.console.log(`Tree-sitter Blade parser initialized (${backend} backend)`);
            }

            return {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Incremental,
                    completionProvider: {
                        resolveProvider: true,
                        triggerCharacters: ['@', "'", '"', '$', '{', '<', ':', ' '],
                    },
                    hoverProvider: true,
                    definitionProvider: true,
                },
            };
        });

        conn.onInitialized(async () => {
            conn.console.log('Laravel Blade LSP initialized');
            const c = Container.get();

            const progress = await Progress.begin('Blade LSP', 'Initializing...');

            const settings = MutableRef.get(c.settings);

            // Register file watchers if the client supports it
            if (MutableRef.get(c.watchCapability)) {
                conn.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: Watcher.getWatchers(),
                });
                conn.console.log('File watchers registered');
            }

            // Check if Laravel integration is disabled
            if (settings.enableLaravelIntegration === false) {
                conn.console.log('Laravel integration disabled via settings');
                progress.done('Ready (static mode)');
                return;
            }

            const workspaceRoot = MutableRef.get(c.workspaceRoot);
            if (!workspaceRoot) {
                progress.done('Ready');
                return;
            }

            await initializeLaravel(conn, progress);
        });

        /**
         * Initialize Laravel project integration.
         * Extracted to reduce nesting depth in onInitialized.
         */
        async function initializeLaravel(
            conn: Connection,
            progress: { report: (msg: string, pct?: number) => void; done: (msg: string) => void },
        ) {
            const c = Container.get();
            const settings = MutableRef.get(c.settings);
            const workspaceRoot = MutableRef.get(c.workspaceRoot)!;

            progress.report('Detecting Laravel project...');
            const success = await Laravel.initialize(workspaceRoot, {
                phpCommand: settings.phpCommand,
                phpEnvironment: settings.phpEnvironment,
                onProgress: (message, percentage) => progress.report(message, percentage),
            });

            if (!success) {
                conn.console.log('No Laravel project detected, using static completions');
                progress.done('Ready (no Laravel project)');
                return;
            }

            const project = Laravel.getProject();
            const envLabel = project?.phpEnvironment?.label ?? 'unknown';
            const phpCmd = project?.phpCommand.join(' ') ?? settings.phpCommand?.join(' ') ?? 'php';
            conn.console.log(`Laravel project integration enabled (${envLabel}: ${phpCmd})`);

            reportRefreshFailures(conn, progress, phpCmd);
        }

        /**
         * Check if the last refresh had partial failures and notify the user.
         */
        function reportRefreshFailures(conn: Connection, progress: { done: (msg: string) => void }, phpCmd: string) {
            const refreshResult = Laravel.getLastRefreshResult();
            if (!refreshResult || refreshResult.errors.length === 0) {
                progress.done('Ready');
                return;
            }

            const failedParts = [
                refreshResult.views === 'failed' ? 'views' : null,
                refreshResult.components === 'failed' ? 'components' : null,
                refreshResult.directives === 'failed' ? 'directives' : null,
            ]
                .filter(Boolean)
                .join(', ');

            conn.sendNotification('window/showMessage', {
                type: MessageType.Warning,
                message: `Blade LSP: Failed to load ${failedParts} from Laravel. PHP command: ${phpCmd}. Check :LspLog for details.`,
            });
            progress.done(`Ready (${failedParts} failed)`);
        }

        // ─── File Watching ─────────────────────────────────────────────────────
        //
        // When the client notifies us of file system changes we selectively
        // refresh only the affected data (views, components, directives).
        // Changes are debounced so rapid saves / git operations don't
        // trigger dozens of PHP processes.

        const debouncedRefresh = Watcher.createDebouncedRefresh(async (targets) => {
            if (!Laravel.isAvailable()) return;

            conn.console.log(`File watcher: refreshing [${[...targets].join(', ')}]`);

            const targetList = [...targets];
            const progress = await Progress.begin('Blade LSP', `Reloading ${targetList.join(', ')}...`);

            const promises: Promise<void>[] = [];
            let completed = 0;
            const total = targetList.length;
            const trackProgress = (label: string) => {
                completed++;
                const pct = Math.round((completed / total) * 100);
                progress.report(`${label} (${completed}/${total})`, pct);
            };

            if (targets.has('views')) {
                promises.push(
                    Views.refresh()
                        .then(() => {
                            trackProgress('Views reloaded');
                        })
                        .catch((err) => {
                            conn.console.error(`File watcher: views refresh failed: ${FormatErrorForLog(err)}`);
                            trackProgress('Views failed');
                        }),
                );
            }

            if (targets.has('components')) {
                promises.push(
                    Components.refresh()
                        .then(() => {
                            trackProgress('Components reloaded');
                        })
                        .catch((err) => {
                            conn.console.error(`File watcher: components refresh failed: ${FormatErrorForLog(err)}`);
                            trackProgress('Components failed');
                        }),
                );
            }

            if (targets.has('directives')) {
                promises.push(
                    Directives.refresh()
                        .then(() => {
                            trackProgress('Directives reloaded');
                        })
                        .catch((err) => {
                            conn.console.error(`File watcher: directives refresh failed: ${FormatErrorForLog(err)}`);
                            trackProgress('Directives failed');
                        }),
                );
            }

            await Promise.allSettled(promises);
            progress.done('Reload complete');
            conn.console.log('File watcher: refresh complete');
        }, 500);

        conn.onDidChangeWatchedFiles((params) => {
            conn.console.log(`File changes detected: ${Watcher.describeChanges(params.changes)}`);

            const targets = Watcher.classifyChanges(params);
            if (targets.size > 0) {
                debouncedRefresh(targets);
            }
        });

        // Document change handler
        docs.onDidChangeContent((change) => {
            const document = change.document;
            const source = document.getText();
            const tree = parseDocument(document);

            // 1. Tree-sitter syntax diagnostics
            const treeDiagnostics = BladeParser.getDiagnostics(tree);
            const syntaxDiagnostics: Diagnostic[] = treeDiagnostics.map((diag) => ({
                severity: mapDiagnosticSeverity(diag.severity),
                range: {
                    start: Position.create(diag.startPosition.row, diag.startPosition.column),
                    end: Position.create(diag.endPosition.row, diag.endPosition.column),
                },
                message: diag.message,
                source: 'blade-lsp',
            }));

            // 2. Semantic diagnostics (view refs, component refs, unclosed directives, @method)
            const semanticDiagnostics = Diagnostics.analyze(source, tree);

            conn.sendDiagnostics({
                uri: document.uri,
                diagnostics: [...syntaxDiagnostics, ...semanticDiagnostics],
            });
        });

        docs.onDidClose((event) => {
            cache.delete(event.document.uri);
            conn.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
        });

        // Completion handler
        conn.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return [];

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const position = params.position;
            const source = document.getText();
            const context = BladeParser.getCompletionContext(tree, source, position.line, position.character);

            const items: CompletionItem[] = [];

            if (context.type === 'directive') {
                // Add built-in directives
                const matchingDirectives = BladeDirectives.getMatching(context.prefix);
                for (const directive of matchingDirectives) {
                    items.push(Completions.createDirectiveItem(directive, context.prefix));
                }

                // Add custom directives from Laravel project
                items.push(...getCustomDirectiveCompletions(context.prefix));
            } else if (context.type === 'html') {
                const line = source.split('\n')[position.line];
                const textBeforeCursor = line.slice(0, position.character);

                if (textBeforeCursor.endsWith('@')) {
                    // Add built-in directives
                    for (const directive of BladeDirectives.all) {
                        items.push(Completions.createDirectiveItem(directive, '@'));
                    }

                    // Add custom directives from Laravel project
                    items.push(...getCustomDirectiveCompletions('@'));
                }

                // Check for livewire component tag start
                if (textBeforeCursor.endsWith('<livewire:') || /<livewire:[\w.-]*$/.test(textBeforeCursor)) {
                    items.push(...Completions.getLivewireCompletions(textBeforeCursor, position));
                }
                // Check for component tag start:
                //   - x- prefixed: <x-button, <x-turbo::frame
                //   - namespace prefixed: <flux:button (but not <livewire:)
                else if (
                    textBeforeCursor.endsWith('<x-') ||
                    /<x-[\w.-]*(?:::[\w.-]*)?$/.test(textBeforeCursor) ||
                    /<[\w]+:[\w.-]*$/.test(textBeforeCursor)
                ) {
                    items.push(...Completions.getComponentCompletions(textBeforeCursor, position));
                }

                // Check for component prop completion (inside component tag).
                const componentPropContext = BladeParser.getComponentTagContext(
                    tree,
                    position.line,
                    position.character,
                );
                if (componentPropContext) {
                    items.push(
                        ...Completions.getComponentPropCompletions(
                            componentPropContext.componentName,
                            componentPropContext.existingProps,
                        ),
                    );
                }

                // Check for slot completion (<x-slot: or <x-slot name=")
                const isColonSyntax = /<x-slot:[\w-]*$/.test(textBeforeCursor);
                const isNameSyntax = /<x-slot\s+name=["'][\w-]*$/.test(textBeforeCursor);
                if (isColonSyntax || isNameSyntax) {
                    items.push(
                        ...Completions.getSlotCompletions(position.line, isColonSyntax ? 'colon' : 'name', tree),
                    );
                }

                // Check for directive parameter completions via regex fallback.
                const directiveParamMatch = textBeforeCursor.match(
                    /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                );
                if (directiveParamMatch) {
                    items.push(...Completions.getParameterCompletions(directiveParamMatch[1]));
                }
            } else if (context.type === 'echo') {
                items.push(...Completions.getLaravelHelperCompletions());
            } else if (context.type === 'parameter') {
                if (context.directiveName) {
                    items.push(...Completions.getParameterCompletions(context.directiveName));
                } else {
                    // Fallback: tree-sitter detected parameter context but couldn't
                    // resolve the directive name (sibling node issue). Try regex.
                    const line = source.split('\n')[position.line];
                    const textBeforeCursor = line.slice(0, position.character);
                    const fallbackMatch = textBeforeCursor.match(
                        /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                    );
                    if (fallbackMatch) {
                        items.push(...Completions.getParameterCompletions(fallbackMatch[1]));
                    }
                }
            }

            return items;
        });

        conn.onCompletionResolve((item: CompletionItem): CompletionItem => item);

        // Hover handler
        conn.onHover((params: TextDocumentPositionParams): Hover | null => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return null;

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const position = params.position;
            const source = document.getText();

            const node = BladeParser.findNodeAtPosition(tree, position.line, position.character);

            // Try directive hover (was 3-level nested if, now flattened with guard clauses)
            const directiveName = node ? BladeParser.extractDirectiveName(node) : null;
            const directive = directiveName ? BladeDirectives.map.get(directiveName) : undefined;
            if (directive) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: Hovers.formatDirective(directive),
                    },
                };
            }

            // Check for special variables
            const lineText = source.split('\n')[position.line];
            const wordAtPosition = Hovers.getWordAtPosition(lineText, position.character);

            if (wordAtPosition === '$loop' || wordAtPosition.startsWith('$loop->')) {
                return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatLoopVariable() } };
            }

            if (wordAtPosition === '$slot') {
                return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatSlotVariable() } };
            }

            if (wordAtPosition === '$attributes' || wordAtPosition.startsWith('$attributes->')) {
                return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatAttributesVariable() } };
            }

            // Check for component hover
            const componentHover = Hovers.getComponentHover(lineText, position.character);
            if (componentHover) {
                return componentHover;
            }

            // Check for component prop hover
            const propHover = Hovers.getPropHover(lineText, position.line, position.character, tree);
            if (propHover) {
                return propHover;
            }

            // Check for view hover in directives
            const viewHover = Hovers.getViewHover(lineText, position.character);
            if (viewHover) {
                return viewHover;
            }

            // Check for slot hover (<x-slot:name> or <x-slot name="name">)
            const slotHover = Hovers.getSlotHover(lineText, position.line, position.character, tree);
            if (slotHover) {
                return slotHover;
            }

            return null;
        });

        // Definition handler (go to definition)
        conn.onDefinition((params: DefinitionParams): Location | null => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return null;

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const source = document.getText();
            const position = params.position;
            const lines = source.split('\n');
            const currentLine = lines[position.line] || '';

            // Check for view reference in directives
            const viewDefinition = Definitions.getViewDefinition(
                currentLine,
                position.character,
                source,
                position.line,
            );
            if (viewDefinition) {
                return viewDefinition;
            }

            // Check for component reference
            const componentDefinition = Definitions.getComponentDefinition(currentLine, position.character);
            if (componentDefinition) {
                return componentDefinition;
            }

            // Check for component prop/attribute reference
            const propDefinition = Definitions.getPropDefinition(currentLine, position.line, position.character, tree);
            if (propDefinition) {
                return propDefinition;
            }

            // Check for slot reference (<x-slot:name> or <x-slot name="name">)
            const slotDefinition = Definitions.getSlotDefinition(currentLine, position.line, position.character, tree);
            if (slotDefinition) {
                return slotDefinition;
            }

            return null;
        });

        docs.listen(conn);
        return conn;
    };

    export function start(conn?: Connection): Connection {
        if (!Container.isReady()) {
            build(conn);
        }
        return Container.get().connection;
    }

    /**
     * Reset all server state. Used between test runs for isolation.
     */
    export function reset(): void {
        Laravel.dispose();
        Container.dispose();
    }
}

// Start the server (only when not in test mode)
if (!process.env.TEST) {
    Server.start().listen();
}
