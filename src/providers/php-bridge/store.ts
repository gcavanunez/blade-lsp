import { PhpBridgeShadowDocument } from './shadow-document';

export namespace PhpBridgeStore {
    export interface Entry {
        bladeUri: string;
        version: number;
        source: string;
        signature: string;
        shadow: PhpBridgeShadowDocument.ShadowDocument;
    }

    export interface Store {
        get(bladeUri: string, version: number, source: string): Entry | null;
        getLatest(bladeUri: string): Entry | null;
        set(entry: Entry): void;
        clear(bladeUri?: string): void;
    }

    export function create(): Store {
        const entries = new Map<string, Entry>();

        return {
            get(bladeUri, version, source) {
                const entry = entries.get(bladeUri) ?? null;
                if (!entry || entry.version !== version || entry.source !== source) {
                    return null;
                }

                return entry;
            },

            getLatest(bladeUri) {
                return entries.get(bladeUri) ?? null;
            },

            set(entry) {
                entries.set(entry.bladeUri, entry);
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
