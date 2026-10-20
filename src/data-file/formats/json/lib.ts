import { ParseError, parseTree, type Node } from 'jsonc-parser';
import { TDataPath, TPathSegment } from '../../types';
import { JsonDataError } from '../../errors';

export function nodeValue<T>(node: Node): T {
  switch (node.type) {
    case 'array':
      return (node.children ?? []).map((child: Node) => nodeValue(child)) as T;
    case 'object': {
      const result: Record<string, unknown> = {};
      for (const prop of node.children ?? []) {
        const keyNode = prop.children?.[0];
        const valueNode = prop.children?.[1];
        if (keyNode && typeof keyNode.value === 'string') {
          result[keyNode.value] = valueNode ? nodeValue(valueNode) : undefined;
        }
      }
      return result as T;
    }
    default:
      return node.value;
  }
}
export function findValueNode(root: Node, dataPath: TDataPath): Node | undefined {
  if (!root) {
    return undefined;
  }
  let node: Node | undefined = root;
  for (const segment of dataPath) {
    if (!node) {
      return undefined;
    }
    node = childNode(node, segment);
  }
  return node;
}

export function childNode(node: Node, segment: TPathSegment): Node | undefined {
  if (node.type === 'object') {
    if (typeof segment !== 'string') {
      // A numeric segment against an object is not an existing composite path.
      return undefined;
    }
    const prop = (node.children ?? []).find((candidate: Node) => candidate.children?.[0]?.value === segment);
    return prop ? (prop.children?.[1] ?? undefined) : undefined;
  }
  if (node.type === 'array') {
    if (typeof segment !== 'number') {
      // A key segment against an array is not an existing composite path.
      return undefined;
    }
    return (node.children ?? [])[segment] ?? undefined;
  }
  // A scalar value is not a container; the rest of the path does not exist.
  return undefined;
}
export function parseTreeOrThrow(fileContent: string): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(fileContent, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const error = errors[0];
    const snippet = fileContent.slice(error.offset, error.offset + error.length) || '<eof>';
    throw new JsonDataError(`Invalid JSON/JSONC content at offset ${error.offset}: ${JSON.stringify(snippet)}`);
  }
  return root;
}
