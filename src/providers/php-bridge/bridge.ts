import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Position, type Hover, type Location } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Server } from '../../server';
import { PhpBridgeBackend } from './backend';
import { PhpBridgeMapping } from './mapping';
import { PhpBridgeRegions } from './regions';
import { PhpBridgeShadowDocument } from './shadow-document';
import { PhpBridgeStore } from './store';

export namespace PhpBridge {
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

        return {
            backendName,
            command,
            workspaceRoot,
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

        const backend = backendFactory(config);
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

    export async function syncDocument(state: State, document: TextDocument): Promise<PhpBridgeStore.Entry> {
        const source = document.getText();
        const cached = state.store.get(document.uri, document.version, source);
        if (cached) {
            return cached;
        }

        const extraction = PhpBridgeRegions.extract(source);
        const shadow = PhpBridgeShadowDocument.build(state.workspaceRoot, document.uri, extraction);

        await mkdir(path.dirname(shadow.shadowPath), { recursive: true });
        await writeFile(shadow.shadowPath, shadow.content, 'utf-8');

        const entry: PhpBridgeStore.Entry = {
            bladeUri: document.uri,
            version: document.version,
            source,
            shadow,
        };
        state.store.set(entry);

        const backend = await ensureBackend(state);
        if (backend) {
            await backend.openOrUpdate({
                uri: shadow.shadowUri,
                version: document.version,
                text: shadow.content,
            });
        }

        return entry;
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
            const entry = await syncDocument(state, document);
            const mapped = PhpBridgeMapping.bladePositionToShadowPosition(document.getText(), entry.shadow, position);
            if (mapped.kind !== 'mapped') {
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
            const entry = await syncDocument(state, document);
            const source = document.getText();
            const mapped = PhpBridgeMapping.bladePositionToShadowPosition(source, entry.shadow, position);
            if (mapped.kind !== 'mapped') {
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
}
