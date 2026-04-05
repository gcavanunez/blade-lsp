import { ParserTypes } from './types';

type SyntaxNode = ParserTypes.SyntaxNode;

export function isPositionWithinNode(node: SyntaxNode, row: number, column: number): boolean {
    if (row < node.startPosition.row || row > node.endPosition.row) return false;
    if (row === node.startPosition.row && column < node.startPosition.column) return false;
    if (row === node.endPosition.row && column > node.endPosition.column) return false;
    return true;
}

export function isStrictlyNarrowerRange(a: SyntaxNode, b: SyntaxNode): boolean {
    if (a.startPosition.row !== b.startPosition.row) return a.startPosition.row > b.startPosition.row;
    if (a.startPosition.column !== b.startPosition.column) return a.startPosition.column > b.startPosition.column;
    if (a.endPosition.row !== b.endPosition.row) return a.endPosition.row < b.endPosition.row;
    return a.endPosition.column < b.endPosition.column;
}
