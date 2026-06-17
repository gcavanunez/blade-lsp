import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SymbolKind } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';

describe('Document Symbols (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                enableLaravelIntegration: false,
            },
        });
    });

    afterAll(async () => {
        await client.shutdown();
    });

    it('returns symbols for sections, stacks, components, and slots', async () => {
        const doc = await client.open({
            text: [
                "@section('hero')",
                "@push('scripts')",
                '<x-button type="primary">',
                '    <x-slot:icon>',
                '        <livewire:counter />',
                '    </x-slot:icon>',
                '</x-button>',
            ].join('\n'),
        });

        const symbols = await doc.symbols();

        expect(symbols.map((item) => item.name)).toEqual(
            expect.arrayContaining(['hero', 'scripts', 'x-button', 'icon', 'livewire:counter']),
        );

        const hero = symbols.find((item) => item.name === 'hero');
        expect(hero?.kind).toBe(SymbolKind.Namespace);

        const scripts = symbols.find((item) => item.name === 'scripts');
        expect(scripts?.kind).toBe(SymbolKind.Array);

        const component = symbols.find((item) => item.name === 'x-button');
        expect(component?.kind).toBe(SymbolKind.Class);

        await doc.close();
    });

    it('returns an empty list for plain html', async () => {
        const doc = await client.open({
            text: '<div><p>Hello</p></div>',
        });

        expect(await doc.symbols()).toEqual([]);

        await doc.close();
    });
});
