import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    CompletionTriggerKind,
    Position,
    TextEdit,
    type CompletionItem,
    type CompletionList,
    type CompletionContext,
    type Hover,
    type Location,
} from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Server } from '../../server';
import { PhpBridgeBackend } from './backend';
import { PhpBridgeMapping } from './mapping';
import { PhpBridgeRegions } from './regions';
import { PhpBridgeShadowDocument } from './shadow-document';
import { PhpBridgeStore } from './store';

export namespace PhpBridge {
    const COMPLETION_BRIDGE_DATA_KEY = '__bladePhpBridge';
    const EAGER_COMPLETION_RESOLVE_LIMIT = 20;

    export interface Logger {
        log(message: string): void;
        error(message: string): void;
    }

    export interface State {
        workspaceRoot: string;
        settings: Server.Settings;
        logger: Logger;
        store: PhpBridgeStore.Store;
        backend: PhpBridgeBackend.Client | null;
        shadowVersion: number;
    }

    type BackendFactory = (config: PhpBridgeBackend.BackendConfig) => PhpBridgeBackend.Client;

    let backendFactory: BackendFactory = PhpBridgeBackend.createLspClient;

    export function setBackendFactoryForTests(factory: BackendFactory | null): void {
        backendFactory = factory ?? PhpBridgeBackend.createLspClient;
    }

    export function createState(workspaceRoot: string, settings: Server.Settings, logger: Logger): State {
        return {
            workspaceRoot,
            settings,
            logger,
            store: PhpBridgeStore.create(),
            backend: null,
            shadowVersion: 0,
        };
    }

    export function isEnabled(settings: Server.Settings): boolean {
        return settings.enableEmbeddedPhpBridge === true;
    }

    export function resolveBackendConfig(
        settings: Server.Settings,
        workspaceRoot: string,
    ): PhpBridgeBackend.BackendConfig | null {
        if (!isEnabled(settings)) {
            return null;
        }

        const backendName = settings.embeddedPhpBackend ?? 'intelephense';
        const command = settings.embeddedPhpLspCommand ?? PhpBridgeBackend.resolveDefaultCommand(backendName);
        if (!command || command.length === 0) {
            return null;
        }

        const defaultIntelephenseInit = {
            globalStoragePath: path.join(process.env.HOME ?? workspaceRoot, '.local', 'share', 'intelephense'),
            storagePath: path.join(process.env.HOME ?? workspaceRoot, '.local', 'share', 'intelephense'),
        };
        const defaultIntelephenseSettings = {
            intelephense: {
                client: {
                    autoCloseDocCommentDoSuggest: true,
                },
                files: {
                    maxSize: 10_000_000,
                },
            },
        };

        return {
            backendName,
            command,
            workspaceRoot,
            initializationOptions:
                backendName === 'intelephense'
                    ? {
                          ...defaultIntelephenseInit,
                          ...(settings.intelephense?.initializationOptions ?? {}),
                      }
                    : (settings.phpactor?.initializationOptions ?? undefined),
            settings:
                backendName === 'intelephense'
                    ? {
                          ...defaultIntelephenseSettings,
                          ...(settings.intelephense?.settings ?? {}),
                      }
                    : (settings.phpactor?.settings ?? undefined),
        };
    }

    export async function ensureBackend(state: State): Promise<PhpBridgeBackend.Client | null> {
        if (state.backend) {
            return state.backend;
        }

        const config = resolveBackendConfig(state.settings, state.workspaceRoot);
        if (!config) {
            return null;
        }

        const backend = backendFactory({
            ...config,
            logger: state.logger,
        });
        try {
            await backend.start();
            state.backend = backend;
            state.logger.log(`Embedded PHP bridge backend started (${config.backendName})`);
            return backend;
        } catch (error) {
            state.logger.error(`Embedded PHP bridge backend failed to start: ${String(error)}`);
            return null;
        }
    }

    export async function syncDocument(
        state: State,
        document: TextDocument,
        activePosition?: Position,
    ): Promise<PhpBridgeStore.BridgeDocumentState> {
        const source = document.getText();
        const current = state.store.get(document.uri);
        if (current && current.bladeVersion === document.version && current.source === source) {
            if (!activePosition) {
                return current;
            }

            const activeRegion = PhpBridgeRegions.getRegionAtPosition(
                source,
                current.extraction.regions,
                activePosition,
            );
            if ((activeRegion?.id ?? null) === current.activeRegionId) {
                return current;
            }
        }

        const extraction = PhpBridgeRegions.extract(source);
        const activeRegion = activePosition
            ? PhpBridgeRegions.getRegionAtPosition(source, extraction.regions, activePosition)
            : null;
        const activeRegionId = activeRegion?.id ?? null;
        const backendName = state.settings.embeddedPhpBackend ?? 'intelephense';
        const shadow = PhpBridgeShadowDocument.build(state.workspaceRoot, document.uri, extraction, {
            activeRegionId: activeRegionId ?? undefined,
            shadowDirectory:
                backendName === 'phpactor'
                    ? path.join('app', 'BladeLspShadow')
                    : path.join('vendor', 'blade-lsp', 'shadow'),
        });
        const previous = state.store.get(document.uri);
        const { state: documentState, phpChanged } = state.store.apply(document, extraction, shadow, activeRegionId);
        const shouldResyncBackend = !previous || phpChanged;

        state.logger.log(
            `[php-bridge] sync ${document.uri} bladeVersion=${document.version} phpChanged=${String(phpChanged)} regions=${extraction.regions.length} activeRegion=${activeRegionId ?? 'none'}`,
        );

        if (shouldResyncBackend) {
            await mkdir(path.dirname(shadow.shadowPath), { recursive: true });
            await writeFile(shadow.shadowPath, shadow.content, 'utf-8');
            state.shadowVersion += 1;
            const backend = await ensureBackend(state);
            if (backend) {
                await backend.openOrUpdate({
                    uri: shadow.shadowUri,
                    version: state.shadowVersion,
                    text: shadow.content,
                });
                state.store.markBackendSynced(document.uri, state.shadowVersion);
            }
        }

        return state.store.get(document.uri) ?? documentState;
    }

    export async function shutdown(state: State): Promise<void> {
        if (state.backend) {
            await state.backend.shutdown();
        }

        state.backend = null;
        state.store.clear();
    }

    export async function getHover(state: State, document: TextDocument, position: Position): Promise<Hover | null> {
        try {
            const entry = await syncDocument(state, document, position);
            const mapped = PhpBridgeMapping.bladePositionToShadowPosition(entry.source, entry.shadow, position);
            if (mapped.kind !== 'mapped') {
                state.logger.log(
                    `[php-bridge] hover fallback for ${document.uri} at ${position.line}:${position.character} (kind=${mapped.kind})`,
                );
                return null;
            }

            const backend = await ensureBackend(state);
            if (!backend) {
                return null;
            }

            return await backend.hover(entry.shadow.shadowUri, mapped.position);
        } catch (error) {
            state.logger.error(`Embedded PHP bridge hover failed: ${String(error)}`);
            return null;
        }
    }

    export async function getDefinition(
        state: State,
        document: TextDocument,
        position: Position,
    ): Promise<Location | Location[] | null> {
        try {
            const entry = await syncDocument(state, document, position);
            const source = entry.source;
            const mapped = PhpBridgeMapping.bladePositionToShadowPosition(source, entry.shadow, position);
            if (mapped.kind !== 'mapped') {
                state.logger.log(
                    `[php-bridge] definition fallback for ${document.uri} at ${position.line}:${position.character} (kind=${mapped.kind})`,
                );
                return null;
            }

            const backend = await ensureBackend(state);
            if (!backend) {
                return null;
            }

            const result = await backend.definition(entry.shadow.shadowUri, mapped.position);
            if (!result) {
                return null;
            }

            const locations = Array.isArray(result) ? result : [result];
            const remapped = locations.flatMap((location) => {
                if (location.uri !== entry.shadow.shadowUri) {
                    return [location];
                }

                const mappedRange = PhpBridgeMapping.shadowRangeToBladeRange(source, entry.shadow, location.range);
                if (mappedRange.kind !== 'mapped') {
                    return [];
                }

                return [
                    {
                        uri: document.uri,
                        range: mappedRange.range,
                    } satisfies Location,
                ];
            });

            if (remapped.length === 0) {
                return null;
            }

            return Array.isArray(result) ? remapped : (remapped[0] ?? null);
        } catch (error) {
            state.logger.error(`Embedded PHP bridge definition failed: ${String(error)}`);
            return null;
        }
    }

    function remapTextEdit(
        source: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        edit: TextEdit | undefined,
    ): TextEdit | null {
        if (!edit) {
            return null;
        }

        const mapped = PhpBridgeMapping.shadowRangeToBladeRange(source, shadow, edit.range);
        if (mapped.kind !== 'mapped') {
            return null;
        }

        return {
            newText: edit.newText,
            range: mapped.range,
        };
    }

    function remapAdditionalTextEdit(
        source: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        edit: TextEdit,
    ): TextEdit | null {
        const mapped = remapTextEdit(source, shadow, edit);
        if (mapped) {
            return mapped;
        }

        const firstRegion = shadow.regions[0];
        if (!firstRegion) {
            return null;
        }

        const shadowStart = PhpBridgeMapping.positionToOffset(shadow.content, edit.range.start);
        const shadowEnd = PhpBridgeMapping.positionToOffset(shadow.content, edit.range.end);
        const isInsertion = shadowStart === shadowEnd;
        if (!isInsertion || shadowStart > firstRegion.shadowContentOffsetStart) {
            return null;
        }

        const bladeInsertPosition = PhpBridgeMapping.offsetToPosition(source, firstRegion.bladeContentOffsetStart);
        return {
            newText: edit.newText,
            range: {
                start: bladeInsertPosition,
                end: bladeInsertPosition,
            },
        };
    }

    function remapCompletionItem(
        source: string,
        shadow: PhpBridgeShadowDocument.ShadowDocument,
        item: CompletionItem,
    ): CompletionItem | null {
        const textEdit =
            'textEdit' in item ? remapTextEdit(source, shadow, item.textEdit as TextEdit | undefined) : null;
        if ('textEdit' in item && item.textEdit && !textEdit) {
            return null;
        }

        const additionalTextEdits = item.additionalTextEdits
            ?.map((edit) => remapAdditionalTextEdit(source, shadow, edit))
            .filter((edit): edit is TextEdit => !!edit);
        if (
            item.additionalTextEdits &&
            item.additionalTextEdits.length > 0 &&
            (!additionalTextEdits || additionalTextEdits.length !== item.additionalTextEdits.length)
        ) {
            return null;
        }

        return {
            ...item,
            data: {
                ...(typeof item.data === 'object' && item.data !== null ? item.data : {}),
                [COMPLETION_BRIDGE_DATA_KEY]: true,
                bladeUri: shadow.bladeUri,
            },
            ...(textEdit ? { textEdit } : {}),
            ...(additionalTextEdits ? { additionalTextEdits } : {}),
        };
    }

    function scoreCompletionItem(item: CompletionItem): number {
        const detail = typeof item.detail === 'string' ? item.detail : '';
        const docsValue =
            item.documentation && typeof item.documentation === 'object' && 'value' in item.documentation
                ? item.documentation.value
                : typeof item.documentation === 'string'
                  ? item.documentation
                  : '';
        const importText = item.additionalTextEdits?.map((edit) => edit.newText).join('\n') ?? '';

        let score = 0;
        if (item.label.includes('(App)')) score += 100;
        if (detail.includes('App\\Models\\')) score += 80;
        if (docsValue.includes('App\\Models\\')) score += 60;
        if (importText.includes('use App\\')) score += 40;
        if (typeof item.sortText === 'string' && item.sortText.startsWith('0')) score += 5;
        return score;
    }

    function sortBridgeCompletionItems(items: CompletionItem[]): CompletionItem[] {
        return [...items].sort((left, right) => {
            const delta = scoreCompletionItem(right) - scoreCompletionItem(left);
            if (delta !== 0) return delta;

            const leftSort = typeof left.sortText === 'string' ? left.sortText : left.label;
            const rightSort = typeof right.sortText === 'string' ? right.sortText : right.label;
            return String(leftSort).localeCompare(String(rightSort));
        });
    }

    export async function getCompletion(
        state: State,
        document: TextDocument,
        position: Position,
        context?: CompletionContext,
    ): Promise<CompletionItem[] | null> {
        try {
            const entry = await syncDocument(state, document, position);
            const source = entry.source;
            const mapped = PhpBridgeMapping.bladePositionToShadowPosition(source, entry.shadow, position);
            if (mapped.kind !== 'mapped') {
                state.logger.log(
                    `[php-bridge] completion fallback for ${document.uri} at ${position.line}:${position.character} (kind=${mapped.kind})`,
                );
                return null;
            }

            const backend = await ensureBackend(state);
            if (!backend) {
                return null;
            }

            const result = await backend.completion(
                entry.shadow.shadowUri,
                mapped.position,
                context ?? { triggerKind: CompletionTriggerKind.Invoked },
            );
            if (!result) {
                return null;
            }

            const items = Array.isArray(result) ? result : result.items;
            const resolvedItems = await Promise.all(
                items.map(async (item, index) => {
                    if (index >= EAGER_COMPLETION_RESOLVE_LIMIT) {
                        return item;
                    }

                    try {
                        return (await backend.resolveCompletion(item)) ?? item;
                    } catch {
                        return item;
                    }
                }),
            );

            const remapped = resolvedItems
                .map((item) => remapCompletionItem(source, entry.shadow, item))
                .filter((item): item is CompletionItem => !!item);

            return sortBridgeCompletionItems(remapped);
        } catch (error) {
            state.logger.error(`Embedded PHP bridge completion failed: ${String(error)}`);
            return null;
        }
    }

    export function isBridgeCompletionItem(item: CompletionItem): boolean {
        return (
            !!item.data &&
            typeof item.data === 'object' &&
            (item.data as Record<string, unknown>)[COMPLETION_BRIDGE_DATA_KEY] === true
        );
    }

    export async function resolveCompletion(state: State, item: CompletionItem): Promise<CompletionItem | null> {
        if (!isBridgeCompletionItem(item)) {
            return null;
        }

        try {
            const backend = await ensureBackend(state);
            if (!backend) {
                return null;
            }

            const resolved = await backend.resolveCompletion(item);
            if (!resolved) {
                return item;
            }

            const bladeUri =
                typeof item.data === 'object' && item.data !== null
                    ? (item.data as Record<string, unknown>).bladeUri
                    : null;
            if (typeof bladeUri !== 'string') {
                return resolved;
            }

            const documentState = state.store.get(bladeUri);
            if (!documentState) {
                return resolved;
            }

            const remapped = remapCompletionItem(documentState.source, documentState.shadow, resolved);
            return remapped ?? item;
        } catch (error) {
            state.logger.error(`Embedded PHP bridge completion resolve failed: ${String(error)}`);
            return null;
        }
    }
}
