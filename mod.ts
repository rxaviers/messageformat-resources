/**
 * @module
 *
 * A parser for MessageFormat 2 Resource files (.mfr).
 *
 * Message resources are containers for Unicode MessageFormat 2 messages,
 * supporting hierarchical organization via sections, metadata attachment,
 * and comments for translator/developer communication.
 *
 * @example
 * ```ts
 * import { parse } from "@luca/messageformat-resources";
 *
 * const resource = parse(`
 * @locale en-US
 * ---
 * hello = Hello, {$name}!
 *
 * [errors]
 * required = This field is required.
 * `);
 *
 * console.log(resource.meta); // [{ key: "locale", value: "en-US" }]
 * console.log(resource.sections[0].entries[0].value); // "Hello, {$name}!"
 * ```
 */

/**
 * The root data model representation of a MessageFormat 2 resource file.
 *
 * A resource contains optional frontmatter (comments and metadata before `---`)
 * and one or more sections containing message entries.
 */
export interface Resource {
  /** Resource-level comment from the frontmatter (before `---`) */
  comment: string;
  /** Resource-level metadata from the frontmatter (before `---`) */
  meta: Metadata[];
  /** Sections containing message entries. The first section may have an empty id for top-level entries. */
  sections: Section[];
}

/**
 * A key-value metadata pair attached to a resource, section, or entry.
 *
 * Metadata lines start with `@` and can be used to attach arbitrary
 * information like locale, author, parameter descriptions, etc.
 *
 * @example
 * ```
 * @locale en-US
 * @param $name - The user's name
 * ```
 */
export interface Metadata {
  /** The metadata key (e.g., "locale", "param", "author") */
  key: string;
  /** The metadata value, which may span multiple lines */
  value: string;
}

/**
 * A section groups related message entries under a common namespace.
 *
 * Sections are defined with `[section.name]` headers. Entries within a
 * section inherit the section's id prefix when flattened.
 */
export interface Section {
  /** Comment attached to this section (lines starting with `#` before the section header) */
  comment: string;
  /** Metadata attached to this section (lines starting with `@` before the section header) */
  meta: Metadata[];
  /** The section identifier as an array of path segments (e.g., `["ui", "buttons"]` for `[ui.buttons]`). Empty array for top-level entries. */
  id: string[];
  /** The entries and standalone comments within this section */
  entries: (Entry | Comment)[];
}

/**
 * A message entry containing a key-value pair where the value is a MessageFormat 2 message.
 */
export interface Entry {
  /** Discriminator for union with Comment type */
  type: "entry";
  /** Comment attached to this entry (lines starting with `#` immediately before the entry) */
  comment: string;
  /** Metadata attached to this entry (lines starting with `@` immediately before the entry) */
  meta: Metadata[];
  /** The entry identifier as an array of path segments (e.g., `["save", "button"]` for `save.button = ...`) */
  id: string[];
  /** The message value in MessageFormat 2 syntax */
  value: string;
}

/**
 * A standalone comment that is not attached to any entry or section.
 *
 * Standalone comments are created when a comment is followed by an empty line
 * rather than an entry or section.
 */
export interface Comment {
  /** Discriminator for union with Entry type */
  type: "comment";
  /** The comment text (without the leading `#`) */
  comment: string;
}

/**
 * Error thrown when parsing fails due to invalid syntax.
 *
 * Includes line and column information for error reporting.
 */
export class ParseError extends SyntaxError {
  /** The name of this error type */
  override name = "ParseError";
  /** The 1-based line number where the error occurred */
  line: number;
  /** The 1-based column number where the error occurred */
  column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`);
    this.line = line;
    this.column = column;
  }
}

/**
 * A flattened message entry with its value and merged metadata.
 *
 * The metadata is merged from all levels: resource → section → entry,
 * with more specific levels overriding less specific ones.
 */
export interface FlattenedMessage {
  /** The message value in MessageFormat 2 syntax */
  message: string;
  /** Merged metadata from resource, section, and entry levels (entry overrides section overrides resource) */
  metadata: Record<string, string>;
}

/**
 * Parse a MessageFormat 2 resource string into a Resource object.
 *
 * @param data The raw resource string to parse
 * @returns The parsed Resource object
 * @throws {ParseError} If the input is not valid MFR syntax
 */
export function parse(data: string): Resource {
  const parser = new Parser(data);
  return parser.parse();
}

/**
 * Flatten a parsed Resource into a Map of message keys to their values and metadata.
 *
 * Message keys are constructed by joining section IDs and entry IDs with dots.
 * For example, an entry with id `["save"]` in section `["ui", "buttons"]`
 * becomes `"ui.buttons.save"`.
 *
 * Metadata is merged from all levels with inheritance:
 * - Resource-level metadata applies to all messages
 * - Section-level metadata overrides resource metadata
 * - Entry-level metadata overrides section and resource metadata
 *
 * @param resource The parsed Resource object
 * @returns A Map from message keys to their flattened representation
 *
 * @example
 * ```ts
 * import { parse, flatten } from "@luca/messageformat-resources";
 *
 * const resource = parse(`
 * @locale en-US
 * ---
 * @param $name - User's name
 * hello = Hello, {$name}!
 *
 * @author translations-team
 * [errors]
 * required = This field is required.
 * `);
 *
 * const messages = flatten(resource);
 * console.log(messages.get("hello"));
 * // { message: "Hello, {$name}!", metadata: { locale: "en-US", param: "$name - User's name" } }
 * console.log(messages.get("errors.required"));
 * // { message: "This field is required.", metadata: { locale: "en-US", author: "translations-team" } }
 * ```
 */
export function flatten(
  resource: Resource,
): Map<string, FlattenedMessage> {
  const result = new Map<string, FlattenedMessage>();

  // Build resource-level metadata
  const resourceMeta: Record<string, string> = {};
  for (const meta of resource.meta) {
    resourceMeta[meta.key] = meta.value;
  }

  for (const section of resource.sections) {
    const sectionPrefix = section.id.length > 0
      ? section.id.join(".") + "."
      : "";

    // Build section-level metadata (inherits from resource)
    const sectionMeta: Record<string, string> = { ...resourceMeta };
    for (const meta of section.meta) {
      sectionMeta[meta.key] = meta.value;
    }

    for (const entry of section.entries) {
      if (entry.type !== "entry") continue;

      const key = sectionPrefix + entry.id.join(".");

      // Build entry-level metadata (inherits from section, which inherits from resource)
      const metadata: Record<string, string> = { ...sectionMeta };
      for (const meta of entry.meta) {
        metadata[meta.key] = meta.value;
      }

      result.set(key, {
        message: entry.value,
        metadata,
      });
    }
  }

  return result;
}

// ============================================================================
// Parser Implementation
// ============================================================================

type LineType =
  | { type: "frontmatter" }
  | { type: "section-head"; id: string[] }
  | { type: "entry"; id: string[]; value: string }
  | { type: "metadata"; key: string; value: string }
  | { type: "comment"; text: string }
  | { type: "empty" }
  | { type: "continuation"; text: string };

class Parser {
  #lines: string[];
  #lineIndex = 0;

  constructor(data: string) {
    // Normalize line endings to LF and split
    this.#lines = data.replace(/\r\n/g, "\n").split("\n");
  }

  parse(): Resource {
    const resource: Resource = {
      comment: "",
      meta: [],
      sections: [],
    };

    // Track pending comments and metadata that will attach to the next item
    let pendingComments: string[] = [];
    let pendingMeta: Metadata[] = [];
    let sawFrontmatter = false;
    let sawEmptyLineAfterComments = false;

    // Current section being built
    let currentSection: Section | null = null;

    while (this.#lineIndex < this.#lines.length) {
      const lineNum = this.#lineIndex;
      const parsed = this.#parseLine();

      if (parsed.type === "empty") {
        // Empty line breaks comment attachment
        if (pendingComments.length > 0 && sawFrontmatter) {
          // Comments become standalone if followed by empty line (after frontmatter)
          sawEmptyLineAfterComments = true;
        }
        this.#lineIndex++;
        continue;
      }

      if (parsed.type === "continuation") {
        throw new ParseError(
          "Unexpected indented line",
          lineNum + 1,
          1,
        );
      }

      if (parsed.type === "comment") {
        if (sawEmptyLineAfterComments && pendingComments.length > 0) {
          // Flush previous comments as standalone
          // Create anonymous section if needed
          if (currentSection === null) {
            currentSection = {
              comment: "",
              meta: [],
              id: [],
              entries: [],
            };
          }
          currentSection.entries.push({
            type: "comment",
            comment: pendingComments.join("\n"),
          });
          pendingComments = [];
        }
        sawEmptyLineAfterComments = false;
        pendingComments.push(parsed.text);
        this.#lineIndex++;
        continue;
      }

      if (parsed.type === "metadata") {
        // Metadata can appear between comments and their target
        // but also breaks any standalone comment grouping
        if (sawEmptyLineAfterComments && pendingComments.length > 0) {
          // Create anonymous section if needed
          if (currentSection === null) {
            currentSection = {
              comment: "",
              meta: [],
              id: [],
              entries: [],
            };
          }
          currentSection.entries.push({
            type: "comment",
            comment: pendingComments.join("\n"),
          });
          pendingComments = [];
        }
        sawEmptyLineAfterComments = false;
        pendingMeta.push({ key: parsed.key, value: parsed.value });
        this.#lineIndex++;
        continue;
      }

      if (parsed.type === "frontmatter") {
        if (sawFrontmatter) {
          throw new ParseError(
            "Duplicate frontmatter",
            lineNum + 1,
            1,
          );
        }
        if (currentSection !== null) {
          throw new ParseError(
            "Frontmatter must appear before any sections or entries",
            lineNum + 1,
            1,
          );
        }
        sawFrontmatter = true;
        resource.comment = pendingComments.join("\n");
        resource.meta = pendingMeta;
        pendingComments = [];
        pendingMeta = [];
        sawEmptyLineAfterComments = false;
        this.#lineIndex++;
        continue;
      }

      if (parsed.type === "section-head") {
        // Flush any standalone comments before starting new section
        if (
          sawEmptyLineAfterComments && pendingComments.length > 0 &&
          currentSection !== null
        ) {
          currentSection.entries.push({
            type: "comment",
            comment: pendingComments.join("\n"),
          });
          pendingComments = [];
        }

        // Save current section if any
        if (currentSection !== null) {
          resource.sections.push(currentSection);
        }

        currentSection = {
          comment: pendingComments.join("\n"),
          meta: pendingMeta,
          id: parsed.id,
          entries: [],
        };
        pendingComments = [];
        pendingMeta = [];
        sawEmptyLineAfterComments = false;
        this.#lineIndex++;
        continue;
      }

      if (parsed.type === "entry") {
        // Flush any standalone comments
        if (
          sawEmptyLineAfterComments && pendingComments.length > 0 &&
          currentSection !== null
        ) {
          currentSection.entries.push({
            type: "comment",
            comment: pendingComments.join("\n"),
          });
          pendingComments = [];
        }

        // Ensure we have a section (create anonymous one if needed)
        if (currentSection === null) {
          currentSection = {
            comment: "",
            meta: [],
            id: [],
            entries: [],
          };
        }

        const entry: Entry = {
          type: "entry",
          comment: pendingComments.join("\n"),
          meta: pendingMeta,
          id: parsed.id,
          value: parsed.value,
        };
        currentSection.entries.push(entry);
        pendingComments = [];
        pendingMeta = [];
        sawEmptyLineAfterComments = false;
        this.#lineIndex++;
        continue;
      }
    }

    // Flush any remaining standalone comments
    if (pendingComments.length > 0) {
      // Create anonymous section if needed
      if (currentSection === null) {
        currentSection = {
          comment: "",
          meta: [],
          id: [],
          entries: [],
        };
      }
      currentSection.entries.push({
        type: "comment",
        comment: pendingComments.join("\n"),
      });
    }

    // Save final section
    if (currentSection !== null) {
      resource.sections.push(currentSection);
    }

    return resource;
  }

  #parseLine(): LineType {
    const line = this.#lines[this.#lineIndex];

    // Empty line
    if (/^[ \t]*$/.test(line)) {
      return { type: "empty" };
    }

    // Continuation line (starts with whitespace)
    if (/^[ \t]/.test(line)) {
      return { type: "continuation", text: line };
    }

    // Frontmatter
    if (/^---[ \t]*$/.test(line)) {
      return { type: "frontmatter" };
    }

    // Comment
    if (line.startsWith("#")) {
      const text = this.#parseCommentText(line.slice(1));
      return { type: "comment", text };
    }

    // Metadata
    if (line.startsWith("@")) {
      return this.#parseMetadataLine(line);
    }

    // Section head
    if (line.startsWith("[")) {
      return this.#parseSectionHead(line);
    }

    // Entry
    return this.#parseEntry(line);
  }

  #parseCommentText(raw: string): string {
    // Trim up to one space or tab from start, and trailing whitespace
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      raw = raw.slice(1);
    }
    return raw.trimEnd();
  }

  #parseMetadataLine(line: string): LineType {
    // @key [value]
    // value can span multiple lines if indented
    const match = line.match(/^@([a-zA-Z0-9_-]+)(?:[ \t]+(.*))?$/);
    if (!match) {
      throw new ParseError(
        "Invalid metadata syntax",
        this.#lineIndex + 1,
        1,
      );
    }

    const key = match[1];
    let value = match[2] ?? "";

    // Check for continuation lines
    value = this.#collectMultilineValue(value);

    return { type: "metadata", key, value: this.#processEscapes(value) };
  }

  #parseSectionHead(line: string): LineType {
    // Handle line continuation: if line ends with \, merge with next line
    let fullLine = line;
    while (
      fullLine.endsWith("\\") && this.#lineIndex + 1 < this.#lines.length
    ) {
      const nextLine = this.#lines[this.#lineIndex + 1];
      // Next line must start with whitespace for continuation
      if (/^[ \t]/.test(nextLine)) {
        this.#lineIndex++;
        // Remove the trailing backslash and add next line (stripped of leading whitespace)
        fullLine = fullLine.slice(0, -1) + nextLine.replace(/^[ \t]+/, "");
      } else {
        break;
      }
    }

    // [id]
    const match = fullLine.match(/^\[[ \t]*(.+?)[ \t]*\][ \t]*$/);
    if (!match) {
      throw new ParseError(
        "Invalid section header syntax",
        this.#lineIndex + 1,
        1,
      );
    }

    const idStr = match[1];
    const id = this.#parseIdentifier(idStr);

    return { type: "section-head", id };
  }

  #parseEntry(line: string): LineType {
    // Handle line continuation in keys: if line ends with \, merge with next line
    let fullLine = line;
    while (
      fullLine.endsWith("\\") && this.#lineIndex + 1 < this.#lines.length
    ) {
      const nextLine = this.#lines[this.#lineIndex + 1];
      // Next line must start with whitespace for continuation
      if (/^[ \t]/.test(nextLine)) {
        this.#lineIndex++;
        // Remove the trailing backslash and add next line (stripped of leading whitespace)
        fullLine = fullLine.slice(0, -1) + nextLine.replace(/^[ \t]+/, "");
      } else {
        break;
      }
    }

    // Find the = sign, accounting for escapes in the key
    const { id, valueStart } = this.#parseEntryKey(fullLine);

    let value = fullLine.slice(valueStart).replace(/^[ \t]*/, "");

    // Check for continuation lines
    value = this.#collectMultilineValue(value);

    return { type: "entry", id, value: this.#processValueEscapes(value) };
  }

  #parseEntryKey(line: string): { id: string[]; valueStart: number } {
    let i = 0;
    const parts: string[] = [];
    let currentPart = "";

    while (i < line.length) {
      const ch = line[i];

      if (ch === "\\") {
        // Escape sequence in identifier
        if (i + 1 >= line.length) {
          throw new ParseError(
            "Unexpected end of line after backslash",
            this.#lineIndex + 1,
            i + 1,
          );
        }
        const next = line[i + 1];

        // Handle line continuation
        if (
          next === "\n" ||
          (i + 2 < line.length && next === "\r" && line[i + 2] === "\n")
        ) {
          // Line continuation in key - need to look at next line
          throw new ParseError(
            "Line continuation in keys not supported in single line",
            this.#lineIndex + 1,
            i + 1,
          );
        }

        // Handle escape - add the escaped character to the current part
        const escaped = this.#processSingleEscape(line, i);
        currentPart += escaped.char;
        i = escaped.nextIndex;
        continue;
      }

      if (ch === "." && currentPart.length > 0) {
        // Dot separator - skip optional whitespace around it
        parts.push(currentPart);
        currentPart = "";
        i++;
        // Skip whitespace after dot
        while (i < line.length && (line[i] === " " || line[i] === "\t")) {
          i++;
        }
        continue;
      }

      if (ch === " " || ch === "\t") {
        // Whitespace - could be before dot or before =
        let j = i;
        while (j < line.length && (line[j] === " " || line[j] === "\t")) {
          j++;
        }
        if (j < line.length && line[j] === ".") {
          // Whitespace before dot
          i = j + 1;
          parts.push(currentPart);
          currentPart = "";
          // Skip whitespace after dot
          while (i < line.length && (line[i] === " " || line[i] === "\t")) {
            i++;
          }
          continue;
        }
        if (j < line.length && line[j] === "=") {
          // End of key
          if (currentPart.length > 0) {
            parts.push(currentPart);
          }
          return { id: parts, valueStart: j + 1 };
        }
        throw new ParseError(
          "Invalid identifier",
          this.#lineIndex + 1,
          i + 1,
        );
      }

      if (ch === "=") {
        // End of key
        if (currentPart.length > 0) {
          parts.push(currentPart);
        }
        if (parts.length === 0) {
          throw new ParseError(
            "Empty identifier",
            this.#lineIndex + 1,
            i + 1,
          );
        }
        return { id: parts, valueStart: i + 1 };
      }

      // Regular character
      currentPart += ch;
      i++;
    }

    throw new ParseError(
      "Expected '=' in entry",
      this.#lineIndex + 1,
      line.length + 1,
    );
  }

  #parseIdentifier(str: string): string[] {
    const parts: string[] = [];
    let currentPart = "";
    let i = 0;

    while (i < str.length) {
      const ch = str[i];

      if (ch === "\\") {
        const escaped = this.#processSingleEscape(str, i);
        currentPart += escaped.char;
        i = escaped.nextIndex;
        continue;
      }

      if (ch === " " || ch === "\t") {
        // Skip whitespace (around dots)
        let j = i;
        while (j < str.length && (str[j] === " " || str[j] === "\t")) {
          j++;
        }
        if (j < str.length && str[j] === ".") {
          // Whitespace before dot
          i = j;
          continue;
        }
        // Whitespace at end
        i = j;
        continue;
      }

      if (ch === ".") {
        if (currentPart.length > 0) {
          parts.push(currentPart);
          currentPart = "";
        }
        i++;
        // Skip whitespace after dot
        while (i < str.length && (str[i] === " " || str[i] === "\t")) {
          i++;
        }
        continue;
      }

      currentPart += ch;
      i++;
    }

    if (currentPart.length > 0) {
      parts.push(currentPart);
    }

    return parts;
  }

  #collectMultilineValue(firstLine: string): string {
    const lines = [firstLine];

    while (this.#lineIndex + 1 < this.#lines.length) {
      const nextLine = this.#lines[this.#lineIndex + 1];
      // Continuation lines must start with whitespace
      if (/^[ \t]/.test(nextLine)) {
        this.#lineIndex++;
        // Strip leading whitespace from continuation line
        lines.push(nextLine.replace(/^[ \t]+/, ""));
      } else {
        break;
      }
    }

    return lines.join("\n");
  }

  #processSingleEscape(
    str: string,
    index: number,
  ): { char: string; nextIndex: number } {
    const next = str[index + 1];

    switch (next) {
      case "\\":
        return { char: "\\", nextIndex: index + 2 };
      case "n":
        return { char: "\n", nextIndex: index + 2 };
      case "r":
        return { char: "\r", nextIndex: index + 2 };
      case "t":
        return { char: "\t", nextIndex: index + 2 };
      case " ":
        return { char: " ", nextIndex: index + 2 };
      case "\t":
        return { char: "\t", nextIndex: index + 2 };
      case "x": {
        // \xNN
        if (index + 4 > str.length) {
          throw new ParseError(
            "Invalid \\x escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        const hex = str.slice(index + 2, index + 4);
        const code = parseInt(hex, 16);
        if (isNaN(code)) {
          throw new ParseError(
            "Invalid \\x escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        return { char: String.fromCharCode(code), nextIndex: index + 4 };
      }
      case "u": {
        // \uNNNN
        if (index + 6 > str.length) {
          throw new ParseError(
            "Invalid \\u escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        const hex = str.slice(index + 2, index + 6);
        const code = parseInt(hex, 16);
        if (isNaN(code)) {
          throw new ParseError(
            "Invalid \\u escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        return { char: String.fromCharCode(code), nextIndex: index + 6 };
      }
      case "U": {
        // \UNNNNNN
        if (index + 8 > str.length) {
          throw new ParseError(
            "Invalid \\U escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        const hex = str.slice(index + 2, index + 8);
        const code = parseInt(hex, 16);
        if (isNaN(code)) {
          throw new ParseError(
            "Invalid \\U escape",
            this.#lineIndex + 1,
            index + 1,
          );
        }
        return { char: String.fromCodePoint(code), nextIndex: index + 8 };
      }
      default:
        // For identifiers, many symbols can be escaped
        // Just return the character after the backslash
        return { char: next, nextIndex: index + 2 };
    }
  }

  #processEscapes(str: string): string {
    let result = "";
    let i = 0;

    while (i < str.length) {
      if (str[i] === "\\") {
        if (i + 1 >= str.length) {
          result += "\\";
          i++;
          continue;
        }

        const next = str[i + 1];

        // Handle line continuation
        if (next === "\n") {
          // Skip the backslash and newline
          i += 2;
          // Skip leading whitespace on next line
          while (i < str.length && (str[i] === " " || str[i] === "\t")) {
            i++;
          }
          continue;
        }

        const escaped = this.#processSingleEscape(str, i);
        result += escaped.char;
        i = escaped.nextIndex;
      } else {
        result += str[i];
        i++;
      }
    }

    return result;
  }

  #processValueEscapes(str: string): string {
    let result = "";
    let i = 0;

    while (i < str.length) {
      if (str[i] === "\\") {
        if (i + 1 >= str.length) {
          result += "\\";
          i++;
          continue;
        }

        const next = str[i + 1];

        // Handle line continuation
        if (next === "\n") {
          // Skip the backslash and newline
          i += 2;
          // Skip leading whitespace on next line
          while (i < str.length && (str[i] === " " || str[i] === "\t")) {
            i++;
          }
          continue;
        }

        // MF2 escapes pass through unchanged
        if (next === "{" || next === "|" || next === "}") {
          result += "\\";
          result += next;
          i += 2;
          continue;
        }

        // Handle backslash-backslash: first check if it's \\{ \\| \\}
        if (next === "\\") {
          // Check what comes after the second backslash
          if (i + 2 < str.length) {
            const afterDouble = str[i + 2];
            if (
              afterDouble === "{" || afterDouble === "|" || afterDouble === "}"
            ) {
              // This is \\ followed by \{ or \| or \}
              // The \\ becomes \ and we continue
              result += "\\";
              i += 2;
              continue;
            }
          }
          // Regular \\ -> \
          result += "\\";
          i += 2;
          continue;
        }

        const escaped = this.#processSingleEscape(str, i);
        result += escaped.char;
        i = escaped.nextIndex;
      } else {
        result += str[i];
        i++;
      }
    }

    return result;
  }
}
