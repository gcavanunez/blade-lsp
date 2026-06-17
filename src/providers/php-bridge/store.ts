import { PhpBridgeShadowDocument } from './shadow-document';

export namespace PhpBridgeStore {
    export interface Entry {
        bladeUri: string;
        version: number;
        shadow: PhpBridgeShadowDocument.ShadowDocument;
    }

    export interface Store {
        get(bladeUri: string, version: number): Entry | null;
        set(entry: Entry): void;
        clear(bladeUri?: string): void;
    }

    export function create(): Store {
        const entries = new Map<string, Entry>();

        return {
            get(bladeUri, version) {
                const entry = entries.get(bladeUri) ?? null;
                if (!entry || entry.version !== version) {
                    return null;
                }

                return entry;
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
