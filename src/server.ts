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
        /** Command array to execute PHP (defaults to auto-detect if not provided) */
        phpCommand?: string[];
        /** Preferred PHP environment — skips auto-detection and tries only this one. */
        phpEnvironment?: PhpEnvironment.Name;
        enableLaravelIntegration?: boolean;
        /** Parser backend: 'wasm' (web-tree-sitter) or 'native' (node-gyp). Defaults to 'wasm'. */
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
        Container.build(externalConn);
        const { connection: conn, documents: docs, treeCache: cache } = Container.get();

        conn.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
            const c = Container.get();

            MutableRef.set(c.workspaceRoot, params.workspaceFolders?.at(0)?.uri?.replace('file://', '') ?? null);

            const settings = (params.initializationOptions as Settings) ?? {};
            MutableRef.set(c.settings, settings);
            conn.console.log(`Settings received: ${JSON.stringify(settings)}`);

            MutableRef.set(
                c.watchCapability,
                !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration,
            );

            const supportsProgress = !!params.capabilities.window?.workDoneProgress;
            Progress.initialize(conn, supportsProgress);

            const backend = settings.parserBackend ?? 'wasm';
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

            if (MutableRef.get(c.watchCapability)) {
                conn.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: Watcher.getWatchers(),
                });
                conn.console.log('File watchers registered');
            }

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
                conn.console.log('No Laravel or Jigsaw project detected, using static completions');
                progress.done('Ready (no project detected)');
                return;
            }

            const project = Laravel.getProject();
            const framework = project?.type ?? 'unknown';
            const envLabel = project?.phpEnvironment?.label ?? 'unknown';
            const phpCmd = project?.phpCommand.join(' ') ?? settings.phpCommand?.join(' ') ?? 'php';
            conn.console.log(`${framework} project integration enabled (${envLabel}: ${phpCmd})`);

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

        docs.onDidChangeContent((change) => {
            const document = change.document;
            const source = document.getText();
            const tree = parseDocument(document);

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

        conn.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return [];

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const position = params.position;
            const source = document.getText();
            const context = BladeParser.getCompletionContext(tree, source, position.line, position.character);

            const items: CompletionItem[] = [];

            if (context.type === 'directive') {
                const matchingDirectives = BladeDirectives.getMatching(context.prefix);
                for (const directive of matchingDirectives) {
                    items.push(Completions.createDirectiveItem(directive, context.prefix));
                }

                items.push(...getCustomDirectiveCompletions(context.prefix));
            } else if (context.type === 'html') {
                const line = source.split('\n')[position.line];
                const textBeforeCursor = line.slice(0, position.character);

                if (textBeforeCursor.endsWith('@')) {
                    for (const directive of BladeDirectives.all) {
                        items.push(Completions.createDirectiveItem(directive, '@'));
                    }

                    items.push(...getCustomDirectiveCompletions('@'));
                }

                if (textBeforeCursor.endsWith('<livewire:') || /<livewire:[\w.-]*$/.test(textBeforeCursor)) {
                    items.push(...Completions.getLivewireCompletions(textBeforeCursor, position));
                } else if (
                    textBeforeCursor.endsWith('<x-') ||
                    /<x-[\w.-]*(?:::[\w.-]*)?$/.test(textBeforeCursor) ||
                    /<[\w]+:[\w.-]*$/.test(textBeforeCursor)
                ) {
                    items.push(...Completions.getComponentCompletions(textBeforeCursor, position));
                }

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

                const isColonSyntax = /<x-slot:[\w-]*$/.test(textBeforeCursor);
                const isNameSyntax = /<x-slot\s+name=["'][\w-]*$/.test(textBeforeCursor);
                if (isColonSyntax || isNameSyntax) {
                    items.push(
                        ...Completions.getSlotCompletions(position.line, isColonSyntax ? 'colon' : 'name', tree),
                    );
                }

                const directiveParamMatch = textBeforeCursor.match(
                    /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                );
                if (directiveParamMatch) {
                    items.push(...Completions.getParameterCompletions(directiveParamMatch[1]));
                }
            } else if (context.type === 'echo') {
                items.push(...Completions.getLaravelHelperCompletions());
            } else if (context.type === 'php' || context.type === 'parameter') {
                // When inside a directive parameter or a php_only node (broken tree),
                // always use regex on the current line to determine the directive name.
                // The tree walk-up can incorrectly find a parent directive (e.g. @section)
                // when the cursor is inside a nested incomplete @include('.
                const line = source.split('\n')[position.line];
                const textBeforeCursor = line.slice(0, position.character);
                const directiveParamMatch = textBeforeCursor.match(
                    /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                );
                if (directiveParamMatch) {
                    items.push(...Completions.getParameterCompletions(directiveParamMatch[1]));
                }
            }

            return items;
        });

        conn.onCompletionResolve((item: CompletionItem): CompletionItem => item);

        conn.onHover((params: TextDocumentPositionParams): Hover | null => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return null;

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const position = params.position;
            const source = document.getText();

            const node = BladeParser.findNodeAtPosition(tree, position.line, position.character);

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

            const componentHover = Hovers.getComponentHover(lineText, position.character);
            if (componentHover) {
                return componentHover;
            }

            const propHover = Hovers.getPropHover(lineText, position.line, position.character, tree);
            if (propHover) {
                return propHover;
            }

            const viewHover = Hovers.getViewHover(lineText, position.character);
            if (viewHover) {
                return viewHover;
            }

            const slotHover = Hovers.getSlotHover(lineText, position.line, position.character, tree);
            if (slotHover) {
                return slotHover;
            }

            return null;
        });

        conn.onDefinition((params: DefinitionParams): Location | null => {
            const document = docs.get(params.textDocument.uri);
            if (!document) return null;

            const tree = cache.get(params.textDocument.uri) || parseDocument(document);
            const source = document.getText();
            const position = params.position;
            const lines = source.split('\n');
            const currentLine = lines[position.line] || '';

            const viewDefinition = Definitions.getViewDefinition(
                currentLine,
                position.character,
                source,
                position.line,
            );
            if (viewDefinition) {
                return viewDefinition;
            }

            const componentDefinition = Definitions.getComponentDefinition(currentLine, position.character);
            if (componentDefinition) {
                return componentDefinition;
            }

            const propDefinition = Definitions.getPropDefinition(currentLine, position.line, position.character, tree);
            if (propDefinition) {
                return propDefinition;
            }

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

if (!process.env.TEST) {
    Server.start().listen();
}
