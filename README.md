# messageformat-resources

A TypeScript parser for MessageFormat 2 Resource files (`.mfr`).

Message resources are containers for
[Unicode MessageFormat 2](https://messageformat.dev/) messages, supporting
hierarchical organization via sections, metadata attachment, and comments for
translator/developer communication.

See the
[MFR syntax explainer](https://github.com/w3c/i18n-discuss/blob/3e068fdb8a549935fdff8f8e36086d6dfdd6c476/explainers/message-resources.md)
for full details on the file format.

## Usage

```ts
import { flatten, parse, stringify } from "@luca/messageformat-resources";

const resource = parse(`
# Application messages
@locale en-US
---

hello = Hello, {$name}!

@param $count - Number of items
items =
  .input {$count :integer}
  .match $count
  one {{You have {$count} item.}}
  *   {{You have {$count} items.}}

@author translations-team
[errors]
required = This field is required.
`);

console.log(resource.meta);
// [{ key: "locale", value: "en-US" }]

console.log(resource.sections[0].entries[0]);
// {
//   type: "entry",
//   comment: "",
//   meta: [],
//   id: ["hello"],
//   value: "Hello, {$name}!"
// }

// Flatten for easy message lookup (metadata is inherited from resource/section)
const messages = flatten(resource);

console.log(messages.get("hello"));
// { message: "Hello, {$name}!", metadata: { locale: "en-US" } }

console.log(messages.get("errors.required"));
// { message: "This field is required.", metadata: { locale: "en-US", author: "translations-team" } }
```

## Updating or Creating Resources

`stringify()` is the inverse operation for flattened messages. Pass it a `Map`,
an iterable of entries, or a plain object, followed by an optional options bag.
When `options.original` is provided, it replaces only translatable values while
retaining comments, metadata, whitespace, escapes, ordering, and line endings.
New keys use the longest matching section; otherwise, a section is created from
the key prefix.

```ts
const originalSource = `# Application messages
@locale en-US
---

@param $name - Name of the user being greeted.
hello = Hello, {$name}!

[errors]
required = This field is required.
`;

const translated = new Map([
  ["hello", "Olá, {$name}!"],
  ["errors.required", "Este campo é obrigatório."],
  ["profile.title", "Perfil"],
]);

const output = stringify(translated, {
  original: originalSource,
  locale: "pt-BR",
});

console.log(output);
```

Output:

```mfr
# Application messages
@locale pt-BR
---

@param $name - Name of the user being greeted.
hello = Olá, {$name}!

[errors]
required = Este campo é obrigatório.

[profile]
title = Perfil
```

The resource comment and `@param` metadata remain unchanged, `@locale` and
existing message values are updated, and the new `profile.title` key creates a
`[profile]` section.

The optional `locale` option updates resource-level `@locale` metadata and is
also used when expanding plural categories. If the resource has no locale
metadata—or no frontmatter—it is added in the correct position. The `original`
option accepts MFR source text.

Without an original resource, `stringify()` creates a minimal valid resource:

```ts
const output = stringify(
  {
    hello: "Hello!",
    "errors.required": "This field is required.",
  },
  { locale: "en-US" },
);
```

Values may also be `FlattenedMessage` objects returned by `flatten()`. Locale
metadata is used for numeric selectors: missing CLDR plural categories are added
using `Intl.PluralRules`. New categories initially copy the exhaustive `*`
pattern, so they should be translated before publishing.

## Syntax Overview

### Resource Structure

```
# Resource comment
@locale en-US
@version 1.0
---

# Entry comment
@param $name - The user's name
hello = Hello, {$name}!

[section.name]
key = value
```

- **Frontmatter**: Resource-level comments and metadata before `---`
- **Sections**: Group messages with `[section.name]` headers
- **Entries**: Key-value pairs where values are
  [MF2 messages](https://messageformat.dev/)
- **Comments**: Lines starting with `#`, attach to next item
- **Metadata**: Lines starting with `@`, attach to next item

### Multiline Values

Values can span multiple lines when continuation lines are indented:

```
message = First line
  second line
  third line
```

### Escape Sequences

- `\\` - Backslash
- `\n` - Newline
- `\r` - Carriage return
- `\t` - Tab
- `\xNN` - Hex escape
- `\uNNNN` - Unicode escape
- `\UNNNNNN` - Unicode escape (6 digits)
- `\{`, `\|`, `\}` - Pass through for MF2

### Line Continuation

Use `\` at end of line to continue on next indented line without adding
whitespace:

```
very-long-\
  key = value

key = This is a very long message that \
  continues on the next line.
```

## License

MIT
