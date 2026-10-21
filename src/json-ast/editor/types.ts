/**
 * Types of the path based JSON AST editor.
 *
 * `JsonAstPathSegment` and `JsonAstPath` are the public path types, the rest describes the
 * internal contract between the files of this folder.
 */
import type { JsonAstNode } from '../types';


/** Formatting of a container, taken from its own `prolog`/`epilog`. */
export interface ContainerStyle {
  /** Whether the container spreads its children over several lines. */
  readonly multiline: boolean;
  /** Indentation of the children of a multiline container (`''` when single-line). */
  readonly indent: string;
  /** Text that separates two children (`,` plus whitespace). */
  readonly separator: string;
  /** Line break of the document (`'\n'` or `'\r\n'`), used for every inserted line. */
  readonly newline: string;
}

/** Formatting context for a value the editor is about to build. */
export interface BuildStyle {
  /** Whether containers are laid out over several lines. */
  readonly multiline: boolean;
  /** Indentation of the bracket lines of the value itself. */
  readonly indent: string;
  /** Indentation added per nesting level. */
  readonly step: string;
  /** Line break of the document (`'\n'` or `'\r\n'`), used for every built line. */
  readonly newline: string;
}

/** Location of a value inside the tree: the node plus the slot that holds it. */
export interface Slot {
  /** Addressed node: an object member value, an array element or the document root. */
  readonly node: JsonAstNode;
  /** Object or array that holds the node, `null` for the document root. */
  readonly container: JsonAstNode | null;
  /** Position of the member or element inside {@link container}. */
  readonly slotIndex: number;
}
