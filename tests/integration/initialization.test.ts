import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { TextDocumentSyncKind } from 'vscode-languageserver/node';

describe('Server Initialization', () => {
    let client: Client;

    afterAll(async () => {
        if (client) await client.shutdown();
    });

    it('completes the initialize handshake', async () => {
        client = await createClient();
        expect(client.initializeResult).toBeDefined();
        expect(client.initializeResult.capabilities).toBeDefined();
    });

    it('reports text document sync capability', () => {
        const caps = client.initializeResult.capabilities;
        expect(caps.textDocumentSync).toBe(TextDocumentSyncKind.Incremental);
    });

    it('reports completion provider with trigger characters', () => {
        const caps = client.initializeResult.capabilities;
        expect(caps.completionProvider).toBeDefined();
        expect(caps.completionProvider!.resolveProvider).toBe(true);
        expect(caps.completionProvider!.triggerCharacters).toEqual(expect.arrayContaining(['@', '<', '{', '$']));
    });

    it('reports hover provider', () => {
        const caps = client.initializeResult.capabilities;
        expect(caps.hoverProvider).toBe(true);
    });

    it('reports definition provider', () => {
        const caps = client.initializeResult.capabilities;
        expect(caps.definitionProvider).toBe(true);
    });
});
