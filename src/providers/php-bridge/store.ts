import type { TextDocument } from 'vscode-languageserver-textdocument';
import { PhpBridgeRegions } from './regions';
import { PhpBridgeShadowDocument } from './shadow-document';

export namespace PhpBridgeStore {
    export interface BridgeDocumentState {
        bladeUri: string;
        bladeVersion: number;
        source: string;
        extraction: PhpBridgeRegions.RegionExtraction;
        activeRegionId: string | null;
        shadow: PhpBridgeShadowDocument.ShadowDocument;
        backendSyncedVersion: number | null;
        backendAckVersion: number | null;
    }

    export interface ApplyResult {
        state: BridgeDocumentState;
        phpChanged: boolean;
    }

    export interface Store {
        get(bladeUri: string): BridgeDocumentState | null;
        all(): BridgeDocumentState[];
        apply(
            document: TextDocument,
            extraction: PhpBridgeRegions.RegionExtraction,
            shadow: PhpBridgeShadowDocument.ShadowDocument,
            activeRegionId: string | null,
        ): ApplyResult;
        markBackendSynced(bladeUri: string, shadowVersion: number): void;
        clear(bladeUri?: string): void;
    }

    export function create(): Store {
        const entries = new Map<string, BridgeDocumentState>();

        return {
            get(bladeUri) {
                return entries.get(bladeUri) ?? null;
            },

            all() {
                return [...entries.values()];
            },

            apply(document, extraction, shadow, activeRegionId) {
                const previous = entries.get(document.uri) ?? null;
                const phpChanged =
                    !previous ||
                    previous.extraction.signature !== extraction.signature ||
                    previous.activeRegionId !== activeRegionId;

                const nextState: BridgeDocumentState = {
                    bladeUri: document.uri,
                    bladeVersion: document.version,
                    source: document.getText(),
                    extraction,
                    activeRegionId,
                    shadow,
                    backendSyncedVersion:
                        !previous || phpChanged
                            ? (previous?.backendSyncedVersion ?? null)
                            : previous.backendSyncedVersion,
                    backendAckVersion:
                        !previous || phpChanged ? (previous?.backendAckVersion ?? null) : previous.backendAckVersion,
                };

                entries.set(document.uri, nextState);
                return {
                    state: nextState,
                    phpChanged,
                };
            },

            markBackendSynced(bladeUri, shadowVersion) {
                const current = entries.get(bladeUri);
                if (!current) return;

                entries.set(bladeUri, {
                    ...current,
                    backendSyncedVersion: shadowVersion,
                    backendAckVersion: shadowVersion,
                });
            },

            clear(bladeUri) {
                if (bladeUri) {
                    entries.delete(bladeUri);
                    return;
                }

                entries.clear();
            },
        };
    }
}
