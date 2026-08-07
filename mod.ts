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

/** A value accepted by {@link stringify}. */
export type MessageValue = string | FlattenedMessage;

/**
 * Key-value messages accepted by {@link stringify}.
 *
 * A `Map`, an array of entries, or a plain object may be used. When a
 * {@link FlattenedMessage} is provided, only its `message` and optional
 * `locale` metadata are used; existing resource metadata is never replaced.
 */
export type MessageEntries =
  | Iterable<readonly [string, MessageValue]>
  | Readonly<Record<string, MessageValue>>;

/** Options controlling source preservation and resource-level metadata. */
export interface StringifyOptions {
  /** Original MFR source text to update in place. */
  original?: string;
  /** Resource-level metadata to update or insert before frontmatter. */
  meta?: Readonly<Record<string, string>>;
}

/** Internal message shape shared by all supported key-value input forms. */
interface NormalizedMessage {
  message: string;
  locale?: string;
}

/** A physical source line and its absolute offsets in the original resource. */
interface SourceLine {
  start: number;
  contentEnd: number;
  end: number;
  text: string;
}

/** Source coordinates needed to replace an entry value without reformatting it. */
interface SourceEntry {
  key: string;
  valueStart: number;
  valueEnd: number;
  end: number;
  indent: string;
}

/** A parsed section path and the safe offset for appending another entry. */
interface SourceSection {
  id: string[];
  insertAt: number;
}

/** Structural source index used to plan non-overlapping textual edits. */
interface SourceIndex {
  entries: SourceEntry[];
  sections: SourceSection[];
  newline: string;
}

/**
 * Create a MessageFormat 2 resource from flattened key-value messages.
 *
 * If `options.original` is supplied, existing values are replaced in place and
 * all other source text (comments, metadata, whitespace, escapes, and line
 * endings) is retained. New keys are placed in the longest matching existing
 * section, or in a new section derived from the key.
 *
 * Resource metadata in `options.meta` is updated or inserted before the
 * frontmatter marker. Its `locale` value is also used to make single-selector
 * numeric messages exhaustive for the locale. For example, an Arabic resource
 * receives `zero`, `two`, `few`, and `many` variants when the input only
 * contains English-style `one` and fallback variants. Missing variants
 * initially copy the fallback pattern so that the result remains usable and
 * ready for translation.
 *
 * @param messages Flattened message keys and their MF2 message values
 * @param options Original resource and resource metadata output options
 * @returns A valid MFR source string
 * @throws {TypeError} If the options, original source, or metadata are invalid
 * @throws {RangeError} If `options.meta.locale` is not a valid language tag
 *
 * @example
 * ```ts
 * const output = stringify(
 *   new Map([
 *     ["hello", "Hello!"],
 *     ["errors.required", "This field is required."],
 *   ]),
 *   { original: originalSource, meta: { locale: "pt-BR" } },
 * );
 * ```
 */
export function stringify(
  messages: MessageEntries,
  options: StringifyOptions = {},
): string {
  if (
    options === null || typeof options !== "object" || Array.isArray(options)
  ) {
    throw new TypeError("Stringify options must be an object");
  }
  const { original = "", meta } = options;
  if (typeof original !== "string") {
    throw new TypeError("Original resource must be a string");
  }
  const resourceMeta = normalizeResourceMetadata(meta);
  const locale = resourceMeta.get("locale");
  if (locale !== undefined) {
    Intl.getCanonicalLocales(locale);
  }

  const values = normalizeMessages(messages);
  const source = original;
  if (values.size === 0 && resourceMeta.size === 0) return source;

  if (source === "") {
    return createResource(values, resourceMeta);
  }

  // Parsing first gives us the same key and metadata semantics as flatten().
  // It also ensures we do not attempt source-preserving edits on invalid input.
  const originalMessages = flatten(parse(source));
  const index = indexSource(source);
  const seen = new Set<string>();
  const edits: { start: number; end: number; text: string }[] = [];

  for (const entry of index.entries) {
    const replacement = values.get(entry.key);
    if (!replacement) continue;
    seen.add(entry.key);

    const messageLocale = locale ?? replacement.locale ??
      originalMessages.get(entry.key)?.metadata.locale;
    const message = expandPluralVariants(replacement.message, messageLocale);
    const current = originalMessages.get(entry.key)?.message;
    if (message === current) continue;

    edits.push({
      start: entry.valueStart,
      end: entry.valueEnd,
      text: renderValue(message, index.newline, entry.indent),
    });
  }

  const additions = [...values].filter(([key]) => !seen.has(key));
  addNewEntries(source, index, originalMessages, additions, edits, locale);
  if (resourceMeta.size > 0) {
    planResourceMetadataUpdates(source, index.newline, resourceMeta, edits);
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/** Renders a normalized metadata value with valid continuation indentation. */
function renderMetadataValue(value: string, newline = "\n"): string {
  return value.split("\n").map(encodeMetadataLine).join(`${newline}  `);
}

/** Escapes one logical metadata line according to resource value syntax. */
function encodeMetadataLine(line: string): string {
  let result = "";
  for (let i = 0; i < line.length;) {
    const code = line.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    if (char === "\\") {
      result += "\\\\";
    } else if (char === "\r") {
      result += "\\r";
    } else if (code < 0x20 && char !== "\t") {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else if (i === 0 && char === " ") {
      result += "\\ ";
    } else if (i === 0 && char === "\t") {
      result += "\\t";
    } else {
      result += char;
    }
    i += char.length;
  }
  return result;
}

/** Normalizes maps, iterables, and objects into one validated message map. */
function normalizeMessages(
  messages: MessageEntries,
): Map<string, NormalizedMessage> {
  const entries: Iterable<readonly [string, MessageValue]> =
    Symbol.iterator in Object(messages)
      ? messages as Iterable<readonly [string, MessageValue]>
      : Object.entries(messages as Readonly<Record<string, MessageValue>>);
  const result = new Map<string, NormalizedMessage>();

  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("Message keys must be non-empty strings");
    }
    const parts = key.split(".");
    if (parts.some((part) => part.length === 0)) {
      throw new TypeError(
        `Invalid empty identifier part in message key: ${key}`,
      );
    }

    if (typeof value === "string") {
      result.set(key, { message: value });
    } else if (
      value && typeof value === "object" &&
      typeof value.message === "string"
    ) {
      result.set(key, {
        message: value.message,
        locale: value.metadata?.locale,
      });
    } else {
      throw new TypeError(`Message value for ${key} must be a string`);
    }
  }
  return result;
}

/** Normalizes and validates resource metadata supplied to {@link stringify}. */
function normalizeResourceMetadata(
  meta: StringifyOptions["meta"],
): Map<string, string> {
  if (meta === undefined) return new Map();
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    throw new TypeError("Resource metadata must be an object");
  }

  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(meta)) {
    // Match the metadata identifier subset currently accepted by parse().
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      throw new TypeError(`Invalid resource metadata key: ${key}`);
    }
    if (typeof value !== "string") {
      throw new TypeError(
        `Resource metadata value for ${key} must be a string`,
      );
    }
    result.set(key, value);
  }
  return result;
}

/** Creates a minimal canonical resource when no original source is supplied. */
function createResource(
  values: Map<string, NormalizedMessage>,
  meta: Map<string, string>,
): string {
  const locale = meta.get("locale");
  const groups = new Map<
    string,
    { section: string[]; entries: [string, NormalizedMessage][] }
  >();
  for (const [key, value] of values) {
    const parts = key.split(".");
    const id = parts.pop()!;
    const sectionKey = parts.join(".");
    let group = groups.get(sectionKey);
    if (!group) {
      group = { section: parts, entries: [] };
      groups.set(sectionKey, group);
    }
    group.entries.push([id, value]);
  }

  const metadata = [...meta].map(([key, value]) =>
    formatResourceMetadata(key, value, "\n")
  );
  const blocks: string[] = [[...metadata, "---"].join("\n")];
  const orderedGroups = [...groups.values()].sort((a, b) =>
    Number(a.section.length > 0) - Number(b.section.length > 0)
  );
  for (const group of orderedGroups) {
    const lines: string[] = [];
    if (group.section.length > 0) {
      lines.push(`[${group.section.map(encodeIdentifierPart).join(".")}]`);
    }
    for (const [id, value] of group.entries) {
      const message = expandPluralVariants(
        value.message,
        locale ?? value.locale,
      );
      lines.push(
        `${encodeIdentifierPart(id)} = ${renderValue(message, "\n", "  ")}`,
      );
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

/**
 * Plans insertions for keys absent from the original resource, preferring the
 * longest matching section and creating a new named section when necessary.
 */
function addNewEntries(
  original: string,
  index: SourceIndex,
  originalMessages: Map<string, FlattenedMessage>,
  additions: [string, NormalizedMessage][],
  edits: { start: number; end: number; text: string }[],
  locale?: string,
): void {
  const existingGroups = new Map<number, string[]>();
  const newSections = new Map<string, { id: string[]; lines: string[] }>();
  const resourceLocale = parse(original).meta.findLast((meta) =>
    meta.key === "locale"
  )?.value;

  for (const [key, value] of additions) {
    const parts = key.split(".");
    const section = longestSectionPrefix(parts, index.sections);
    let entryId: string[];
    if (section) {
      entryId = parts.slice(section.id.length);
    } else {
      entryId = [parts.at(-1)!];
      const sectionId = parts.slice(0, -1);
      const sectionKey = sectionId.join(".");
      let group = newSections.get(sectionKey);
      if (!group) {
        group = { id: sectionId, lines: [] };
        newSections.set(sectionKey, group);
      }
      const messageLocale = locale ?? value.locale ?? resourceLocale;
      group.lines.push(
        formatEntry(entryId, value.message, messageLocale, index.newline),
      );
      continue;
    }

    const messageLocale = locale ?? value.locale ??
      inheritedSectionLocale(
        section.id,
        originalMessages,
        resourceLocale,
      );
    const lines = existingGroups.get(section.insertAt) ?? [];
    lines.push(
      formatEntry(entryId, value.message, messageLocale, index.newline),
    );
    existingGroups.set(section.insertAt, lines);
  }

  for (const [at, lines] of existingGroups) {
    const prefix = at > 0 && original[at - 1] !== "\n" ? index.newline : "";
    edits.push({
      start: at,
      end: at,
      text: prefix + lines.join(index.newline) + index.newline,
    });
  }

  if (newSections.size > 0) {
    const blocks: string[] = [];
    for (const group of newSections.values()) {
      const header = group.id.length > 0
        ? `[${group.id.map(encodeIdentifierPart).join(".")}]${index.newline}`
        : "";
      blocks.push(header + group.lines.join(index.newline));
    }
    const atEnd = edits.find((edit) =>
      edit.start === original.length && edit.end === original.length
    );
    if (atEnd) {
      atEnd.text += index.newline + blocks.join(index.newline + index.newline) +
        index.newline;
      return;
    }

    const needsLine = original.length > 0 && !original.endsWith("\n");
    const needsBlank = original.length > 0 &&
      !original.endsWith(index.newline + index.newline);
    const prefix = (needsLine ? index.newline : "") +
      (needsBlank ? index.newline : "");
    edits.push({
      start: original.length,
      end: original.length,
      text: prefix + blocks.join(index.newline + index.newline) + index.newline,
    });
  }
}

/** Formats one resource metadata property, including multiline values. */
function formatResourceMetadata(
  key: string,
  value: string,
  newline: string,
): string {
  const encoded = renderMetadataValue(value, newline);
  return `@${key}${value === "" ? "" : ` ${encoded}`}`;
}

/**
 * Plans source-preserving updates of resource-level metadata. Missing keys are
 * inserted immediately before frontmatter; a resource without frontmatter
 * receives the requested metadata followed by the required marker.
 */
function planResourceMetadataUpdates(
  source: string,
  newline: string,
  meta: Map<string, string>,
  edits: { start: number; end: number; text: string }[],
): void {
  const lines = sourceLines(source);
  const frontmatterIndex = lines.findIndex((line) =>
    /^---[ \t]*$/.test(line.text)
  );

  if (frontmatterIndex < 0) {
    const metadata = [...meta].map(([key, value]) =>
      formatResourceMetadata(key, value, newline)
    ).join(newline);
    edits.push({
      start: 0,
      end: 0,
      text: `${metadata}${newline}---${newline}`,
    });
    return;
  }

  const found = new Set<string>();
  for (let i = 0; i < frontmatterIndex; i++) {
    const line = lines[i];
    const match = line.text.match(
      /^@([a-zA-Z0-9_-]+)(?:([ \t]+)(.*))?$/,
    );
    if (!match) continue;
    const key = match[1];
    const value = meta.get(key);
    if (value === undefined) continue;
    found.add(key);

    let last = i;
    while (
      last + 1 < frontmatterIndex && /^[ \t]/.test(lines[last + 1].text)
    ) {
      last++;
    }
    const hasSeparator = match[2] !== undefined;
    const encoded = renderMetadataValue(value, newline);
    edits.push({
      start: hasSeparator
        ? line.start + key.length + 1 + match[2].length
        : line.contentEnd,
      end: lines[last].contentEnd,
      text: hasSeparator ? encoded : value === "" ? "" : ` ${encoded}`,
    });
    i = last;
  }

  const missing = [...meta].filter(([key]) => !found.has(key));
  if (missing.length > 0) {
    const metadata = missing.map(([key, value]) =>
      formatResourceMetadata(key, value, newline)
    ).join(newline);
    edits.push({
      start: lines[frontmatterIndex].start,
      end: lines[frontmatterIndex].start,
      text: `${metadata}${newline}`,
    });
  }
}

/** Finds effective locale metadata from an entry in the requested section. */
function inheritedSectionLocale(
  section: string[],
  messages: Map<string, FlattenedMessage>,
  fallback?: string,
): string | undefined {
  const prefix = section.length > 0 ? section.join(".") + "." : "";
  for (const [key, value] of messages) {
    if (key.startsWith(prefix) && value.metadata.locale) {
      return value.metadata.locale;
    }
  }
  return fallback;
}

/** Finds the deepest existing named section that is a prefix of a message key. */
function longestSectionPrefix(
  parts: string[],
  sections: SourceSection[],
): SourceSection | undefined {
  let best: SourceSection | undefined;
  for (const section of sections) {
    if (section.id.length >= parts.length) continue;
    // A dotted key with no matching named section should create that section;
    // treating the anonymous top level as a prefix would instead flatten every
    // new key into a dotted top-level entry.
    if (section.id.length === 0 && parts.length > 1) continue;
    if (section.id.every((part, index) => parts[index] === part)) {
      if (!best || section.id.length >= best.id.length) best = section;
    }
  }
  return best;
}

/** Formats a newly inserted entry with identifier, value, and plural handling. */
function formatEntry(
  id: string[],
  message: string,
  locale: string | undefined,
  newline: string,
): string {
  const key = id.map(encodeIdentifierPart).join(".");
  return `${key} = ${
    renderValue(expandPluralVariants(message, locale), newline, "  ")
  }`;
}

/**
 * Scans valid MFR source into replacement ranges and section insertion points.
 * This index is intentionally lossless: it records offsets without rebuilding
 * comments, metadata, spacing, escapes, or line endings.
 */
function indexSource(source: string): SourceIndex {
  const lines = sourceLines(source);
  const entries: SourceEntry[] = [];
  const sections: SourceSection[] = [{ id: [], insertAt: 0 }];
  let current = sections[0];
  let frontmatterEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]/.test(line.text) || /^[ \t]*$/.test(line.text)) continue;
    if (line.text.startsWith("#") || line.text.startsWith("@")) continue;
    if (/^---[ \t]*$/.test(line.text)) {
      frontmatterEnd = line.end;
      if (current.insertAt === 0) current.insertAt = line.end;
      continue;
    }

    if (line.text.startsWith("[")) {
      const logical = collectLogicalHeader(lines, i);
      i = logical.last;
      const match = logical.text.match(/^\[[ \t]*(.+?)[ \t]*\][ \t]*$/);
      if (!match) continue; // parse(original) already reports the useful error.
      current = { id: decodeIdentifier(match[1]), insertAt: lines[i].end };
      sections.push(current);
      continue;
    }

    const logical = collectLogicalHeader(lines, i);
    const equals = findUnescapedEquals(logical.text);
    if (equals < 0) continue;
    const id = decodeIdentifier(logical.text.slice(0, equals).trimEnd());
    let valueLineIndex = i;
    let physicalEquals = -1;
    for (let candidate = i; candidate <= logical.last; candidate++) {
      physicalEquals = findUnescapedEquals(lines[candidate].text);
      if (physicalEquals >= 0) {
        valueLineIndex = candidate;
        break;
      }
    }
    const valueLine = lines[valueLineIndex];
    if (physicalEquals < 0) continue;
    let valueColumn = physicalEquals + 1;
    while (
      valueLine.text[valueColumn] === " " ||
      valueLine.text[valueColumn] === "\t"
    ) {
      valueColumn++;
    }

    let last = logical.last;
    let indent = "  ";
    while (last + 1 < lines.length && /^[ \t]/.test(lines[last + 1].text)) {
      last++;
      if (indent === "  ") {
        indent = lines[last].text.match(/^[ \t]+/)?.[0] ?? indent;
      }
    }
    const key = [...current.id, ...id].join(".");
    const entry: SourceEntry = {
      key,
      valueStart: valueLine.start + valueColumn,
      valueEnd: lines[last].contentEnd,
      end: lines[last].end,
      indent,
    };
    entries.push(entry);
    current.insertAt = entry.end;
    i = last;
  }

  // A top-level insertion belongs after frontmatter when there were no entries.
  if (sections[0].insertAt === 0) sections[0].insertAt = frontmatterEnd;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return { entries, sections, newline };
}

/** Splits source into physical lines while retaining absolute and CRLF offsets. */
function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < source.length) {
    const lf = source.indexOf("\n", start);
    const end = lf < 0 ? source.length : lf + 1;
    const contentEnd = lf < 0
      ? source.length
      : lf > start && source[lf - 1] === "\r"
      ? lf - 1
      : lf;
    lines.push({
      start,
      contentEnd,
      end,
      text: source.slice(start, contentEnd),
    });
    start = end;
  }
  return lines;
}

/** Joins a continued section header or entry line for structural inspection. */
function collectLogicalHeader(
  lines: SourceLine[],
  start: number,
): { text: string; last: number } {
  let text = lines[start].text;
  let last = start;
  while (
    text.endsWith("\\") && last + 1 < lines.length &&
    /^[ \t]/.test(lines[last + 1].text)
  ) {
    last++;
    text = text.slice(0, -1) + lines[last].text.replace(/^[ \t]+/, "");
  }
  return { text, last };
}

/** Locates an entry delimiter while skipping escaped equals signs. */
function findUnescapedEquals(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      if (text[i + 1] === "x") i += 3;
      else if (text[i + 1] === "u") i += 5;
      else if (text[i + 1] === "U") i += 7;
      else i++;
    } else if (text[i] === "=") {
      return i;
    }
  }
  return -1;
}

/** Decodes an MFR identifier into its structural, unescaped path parts. */
function decodeIdentifier(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === "\\") {
      const escape = decodeIdentifierEscape(text, i);
      part += escape.char;
      i = escape.next;
    } else if (char === ".") {
      parts.push(part);
      part = "";
      i++;
    } else if (char === " " || char === "\t") {
      i++;
    } else {
      part += char;
      i++;
    }
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

/** Decodes one identifier escape and returns the next unread source offset. */
function decodeIdentifierEscape(
  text: string,
  index: number,
): { char: string; next: number } {
  const kind = text[index + 1];
  const lengths: Record<string, number> = { x: 2, u: 4, U: 6 };
  const length = lengths[kind];
  if (length) {
    const code = Number.parseInt(text.slice(index + 2, index + 2 + length), 16);
    return { char: String.fromCodePoint(code), next: index + 2 + length };
  }
  const chars: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  return { char: chars[kind] ?? kind, next: index + 2 };
}

/** Encodes one identifier part without escaping structural separator dots. */
function encodeIdentifierPart(part: string): string {
  let result = "";
  for (const char of part) {
    if (/^[A-Za-z0-9_-]$/u.test(char) || char.codePointAt(0)! >= 0x00a1) {
      result += char;
    } else {
      const code = char.codePointAt(0)!;
      result += code <= 0xff
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : code <= 0xffff
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : `\\U${code.toString(16).padStart(6, "0")}`;
    }
  }
  if (result.startsWith("---") || /^-+$/.test(result)) {
    result = "\\-" + result.slice(1);
  }
  return result;
}

/** Renders a normalized message value using the resource's newline and indent. */
function renderValue(value: string, newline: string, indent: string): string {
  return value.split("\n").map(encodeValueLine).join(newline + indent);
}

/**
 * Escapes one logical message line while passing MF2 `\{`, `\|`, and `\}`
 * escapes through unchanged as required by the resource container syntax.
 */
function encodeValueLine(line: string): string {
  let result = "";
  for (let i = 0; i < line.length;) {
    const code = line.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    if (char === "\\") {
      const next = line[i + 1];
      if (next === "{" || next === "|" || next === "}") {
        result += `\\${next}`;
        i += 2;
        continue;
      }
      result += "\\\\";
    } else if (char === "\r") {
      result += "\\r";
    } else if (code < 0x20 && char !== "\t") {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else if (i === 0 && char === " ") {
      result += "\\ ";
    } else if (i === 0 && char === "\t") {
      result += "\\t";
    } else {
      result += char;
    }
    i += char.length;
  }
  return result;
}

/**
 * Adds missing locale plural categories to a one-selector numeric MF2 message.
 * New variants copy the exhaustive fallback pattern and preserve existing ones.
 */
function expandPluralVariants(message: string, locale?: string): string {
  if (!locale) return message;
  const lines = message.split("\n");
  const matchIndex = lines.findIndex((line) =>
    /^\s*\.match\s+\$[\w-]+\s*$/.test(line)
  );
  if (matchIndex < 0) return message;
  const variable = lines[matchIndex].match(/\$[\w-]+/)?.[0];
  const declaration = lines.find((line) =>
    variable && line.includes(`{${variable}`) &&
    /:(integer|number)\b/.test(line)
  );
  if (!declaration) return message;

  const type = /\bselect\s*=\s*ordinal\b/.test(declaration)
    ? "ordinal"
    : "cardinal";
  let categories: string[];
  try {
    categories = new Intl.PluralRules(locale, { type }).resolvedOptions()
      .pluralCategories.filter((category) => category !== "other");
  } catch {
    return message;
  }

  const variantPattern = /^(\s*)(\*|[\w-]+|=[^\s]+)([ \t]+)(\{\{.*)$/;
  const blocks: { key: string; start: number; end: number }[] = [];
  let patternDepth = 0;
  for (let i = matchIndex + 1; i < lines.length; i++) {
    if (patternDepth === 0) {
      const variant = lines[i].match(variantPattern);
      if (!variant) continue;
      const previous = blocks.at(-1);
      if (previous) previous.end = i;
      blocks.push({ key: variant[2], start: i, end: lines.length });
    }
    patternDepth = Math.max(0, patternDepth + patternDelimiterDelta(lines[i]));
  }
  const fallback = blocks.find((block) => block.key === "*");
  if (!fallback) return message;

  const existing = new Set(blocks.map((block) => block.key));
  const fallbackLines = lines.slice(fallback.start, fallback.end);
  const fallbackMatch = fallbackLines[0].match(variantPattern)!;
  const rank = new Map(categories.map((category, index) => [category, index]));

  for (const category of categories) {
    if (existing.has(category)) continue;
    const copy = [...fallbackLines];
    copy[0] = fallbackMatch[1] + category + fallbackMatch[3] + fallbackMatch[4];

    let insertAt = lines.findIndex((line, index) => {
      if (index <= matchIndex) return false;
      const key = line.match(variantPattern)?.[2];
      return key === "*" ||
        (rank.get(key ?? "") ?? Infinity) > (rank.get(category) ?? Infinity);
    });
    if (insertAt < 0) insertAt = lines.length;
    lines.splice(insertAt, 0, ...copy);
    existing.add(category);
  }
  return lines.join("\n");
}

/** Counts the net `{{`/`}}` pattern nesting change on one MF2 source line. */
function patternDelimiterDelta(line: string): number {
  let result = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const pair = line.slice(i, i + 2);
    if (pair === "{{") {
      result++;
      i++;
    } else if (pair === "}}") {
      result--;
      i++;
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
