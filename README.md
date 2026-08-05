# messageformat-resources

A TypeScript parser for MessageFormat 2 Resource files (`.mfr`).

Message resources are containers for
[Unicode MessageFormat 2](https://messageformat.dev/) messages, supporting
hierarchical organization via sections, metadata attachment, and comments for
translator/developer communication.

See the
[MFR syntax explainer](https://github.com/w3c/i18n-discuss/blob/3e068fdb8a549935fdff8f8e36086d6dfdd6c476/explainers/message-resources.md)
for full details on the file format.

## Installation

### Deno

```sh
deno add jsr:@luca/messageformat-resources
```

### Node.js / npm

Requires Node.js 20 or later. This package is ESM-only.

```sh
npm install messageformat-resources
```

## Usage

The example below uses the npm package name. With Deno, import from
`@luca/messageformat-resources` instead.

```ts
import { flatten, parse } from "messageformat-resources";

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
