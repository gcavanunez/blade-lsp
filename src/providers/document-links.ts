import { DocumentLink, Range } from 'vscode-languageserver/node';
import { Shared } from './shared';
import { Definitions } from './definitions';

export namespace DocumentLinks {
    function createLink(line: number, start: number, end: number, target: string): DocumentLink {
        return {
            range: Range.create(line, start, line, end),
            target,
        };
    }

    export function getLinks(source: string): DocumentLink[] {
        const links: DocumentLink[] = [];
        const lines = source.split('\n');

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];

            for (const match of Shared.getViewReferenceMatches(line)) {
                const target = Definitions.resolveViewLocation(match.value)?.uri;
                if (target) {
                    links.push(createLink(lineNumber, match.start, match.end, target));
                }
            }

            for (const match of Shared.getComponentTagMatches(line)) {
                const target = Definitions.resolveComponentLocation(match.value)?.uri;
                if (target) {
                    links.push(createLink(lineNumber, match.start, match.end, target));
                }
            }
        }

        return links;
    }
}
