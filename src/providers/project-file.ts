import * as fs from 'fs';
import * as path from 'path';
import { Server } from '../server';

export namespace ProjectFile {
    export interface ResolvedFile {
        path: string;
        uri: string;
    }

    export interface ReadFile extends ResolvedFile {
        content: string;
    }

    export function resolve(relativePath: string): ResolvedFile | null {
        const workspaceRoot = Server.getWorkspaceRoot();
        if (!workspaceRoot) {
            return null;
        }

        const fullPath = path.join(workspaceRoot, relativePath);
        return {
            path: fullPath,
            uri: toUri(fullPath),
        };
    }

    export function read(relativePath: string): ReadFile | null {
        const resolved = resolve(relativePath);
        if (!resolved) {
            return null;
        }

        try {
            return {
                ...resolved,
                content: fs.readFileSync(resolved.path, 'utf-8'),
            };
        } catch {
            return null;
        }
    }

    export function toUri(fullPath: string): string {
        return `file://${fullPath}`;
    }
}
