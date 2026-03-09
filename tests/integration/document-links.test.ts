import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { clearMockLaravel, installMockLaravel } from '../utils/laravel-mock';

describe('Document Links (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                enableLaravelIntegration: false,
            },
        });
        installMockLaravel();
    });

    afterAll(async () => {
        await client.shutdown();
        clearMockLaravel();
    });

    it('returns links for view references and component tags', async () => {
        const doc = await client.open({
            text: "@includeFirst(['partials.header', 'partials.footer'])\n<x-button />\n<livewire:counter />",
        });

        const links = await doc.links();
        expect(links.map((item) => item.target)).toEqual(
            expect.arrayContaining([
                'file:///test/project/resources/views/partials/header.blade.php',
                'file:///test/project/resources/views/partials/footer.blade.php',
                'file:///test/project/resources/views/components/button.blade.php',
                'file:///test/project/resources/views/livewire/counter.blade.php',
            ]),
        );

        await doc.close();
    });

    it('omits unresolved targets', async () => {
        const doc = await client.open({
            text: "@include('missing.view')\n<x-missing-widget />",
        });

        expect(await doc.links()).toEqual([]);

        await doc.close();
    });
});
