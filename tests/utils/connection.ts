/**
 * In-memory LSP connection for testing.
 *
 * Adapted from tailwindcss-intellisense's test infrastructure.
 * Uses Node.js Duplex streams to wire server and client together
 * in the same process — no child process, no stdio.
 */

import { Duplex } from 'node:stream';
import {
    createConnection,
    createProtocolConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-languageserver/node';
import type { ProtocolConnection } from 'vscode-languageclient';
import { Server } from '../../src/server';

/**
 * In-memory duplex stream that immediately emits written data.
 * No buffering, no serialization — chunks pass straight through.
 */
class TestStream extends Duplex {
    _write(chunk: Buffer | string, _encoding: string, done: () => void) {
        this.emit('data', chunk);
        done();
    }

    _read(_size: number) {}
}

export interface ConnectResult {
    /** The client-side protocol connection for sending LSP requests */
    clientConnection: ProtocolConnection;
    /** Dispose function to clean up */
    dispose: () => void;
}

/**
 * Create an in-memory LSP connection between the blade-lsp server and a test client.
 *
 * The server runs in-process, connected via TestStream duplex pipes.
 * Returns the client protocol connection for sending LSP requests.
 */
export function connect(): ConnectResult {
    const input = new TestStream();
    const output = new TestStream();

    // Server reads from `input`, writes to `output`
    const serverConn = createConnection(input, output);
    Server.start(serverConn);
    // Server connection must listen() to start processing messages
    serverConn.listen();

    // Client reads from `output`, writes to `input` (swapped)
    // Use the low-level createProtocolConnection with stream readers/writers.
    // This gives us a raw protocol connection suitable for a client
    // (unlike createConnection which creates a full server-type connection).
    const reader = new StreamMessageReader(output);
    const writer = new StreamMessageWriter(input);
    const clientConn = createProtocolConnection(reader, writer) as unknown as ProtocolConnection;
    clientConn.listen();

    return {
        clientConnection: clientConn,
        dispose: () => {
            clientConn.dispose();
            reader.dispose();
            writer.dispose();
            Server.reset();
        },
    };
}
