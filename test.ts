import { assertEquals, assertThrows } from "@std/assert";
import { flatten, parse, stringify } from "./mod.ts";

const testsDir = new URL("./tests/", import.meta.url);

for await (const entry of Deno.readDir(testsDir)) {
  if (entry.isFile && entry.name.endsWith(".mfr")) {
    const testName = entry.name.replace(/\.mfr$/, "");
    const mfrPath = new URL(entry.name, testsDir);
    const jsonPath = new URL(`${testName}.json`, testsDir);

    Deno.test(testName, async () => {
      const input = await Deno.readTextFile(mfrPath);
      const expectedJson = await Deno.readTextFile(jsonPath);
      const expected = JSON.parse(expectedJson);

      const result = parse(input);
      assertEquals(result, expected);
    });
  }
}

// Tests for flatten function
Deno.test("flatten - simple messages", () => {
  const resource = parse(`
---
hello = Hello, world!
goodbye = Goodbye!
`);
  assertEquals(
    flatten(resource),
    new Map([
      ["hello", { message: "Hello, world!", metadata: {} }],
      ["goodbye", { message: "Goodbye!", metadata: {} }],
    ]),
  );
});

Deno.test("flatten - with sections", () => {
  const resource = parse(`
---
top = Top level

[ui.buttons]
save = Save
cancel = Cancel
`);
  assertEquals(
    flatten(resource),
    new Map([
      ["top", { message: "Top level", metadata: {} }],
      ["ui.buttons.save", { message: "Save", metadata: {} }],
      ["ui.buttons.cancel", { message: "Cancel", metadata: {} }],
    ]),
  );
});

Deno.test("flatten - with metadata", () => {
  const resource = parse(`
---
@param $name - The user's name
@example Hello, Alice!
hello = Hello, {$name}!
`);
  assertEquals(
    flatten(resource),
    new Map([
      ["hello", {
        message: "Hello, {$name}!",
        metadata: {
          param: "$name - The user's name",
          example: "Hello, Alice!",
        },
      }],
    ]),
  );
});

Deno.test("flatten - with dotted entry ids", () => {
  const resource = parse(`
---
button.save = Save
button.cancel = Cancel
`);
  assertEquals(
    flatten(resource),
    new Map([
      ["button.save", { message: "Save", metadata: {} }],
      ["button.cancel", { message: "Cancel", metadata: {} }],
    ]),
  );
});

Deno.test("flatten - ignores comments", () => {
  const resource = parse(`
---
hello = Hello

# This is a standalone comment

goodbye = Goodbye
`);
  assertEquals(
    flatten(resource),
    new Map([
      ["hello", { message: "Hello", metadata: {} }],
      ["goodbye", { message: "Goodbye", metadata: {} }],
    ]),
  );
});

Deno.test("flatten - metadata inheritance", () => {
  const resource = parse(`
@locale en-US
@version 1.0
---
@param $name - The user's name
hello = Hello, {$name}!

@author translator-team
[errors]
@category validation
required = This field is required.

@category auth
@override entry-level
login-failed = Login failed.
`);
  const result = flatten(resource);
  assertEquals(result.get("hello"), {
    message: "Hello, {$name}!",
    metadata: {
      locale: "en-US",
      version: "1.0",
      param: "$name - The user's name",
    },
  });
  assertEquals(result.get("errors.required"), {
    message: "This field is required.",
    metadata: {
      locale: "en-US",
      version: "1.0",
      author: "translator-team",
      category: "validation",
    },
  });
  assertEquals(result.get("errors.login-failed"), {
    message: "Login failed.",
    metadata: {
      locale: "en-US",
      version: "1.0",
      author: "translator-team",
      category: "auth",
      override: "entry-level",
    },
  });
});

Deno.test("stringify - updates values without changing non-translatable source", () => {
  const original = [
    "# Resource comment with deliberate spacing  ",
    "@locale pt-BR",
    "---",
    "",
    "# Translator context",
    "@param $name - The user's name",
    "hello   =   Hello, {$name}!",
    "",
    "[errors]   ",
    "# Keep this comment",
    "required = Required.",
    "",
  ].join("\r\n");

  const result = stringify(
    {
      hello: "Olá, {$name}!",
      "errors.required": "Obrigatório.",
    },
    { original },
  );

  assertEquals(
    result,
    original
      .replace("Hello, {$name}!", "Olá, {$name}!")
      .replace("Required.", "Obrigatório."),
  );
  assertEquals(flatten(parse(result)).get("hello")?.message, "Olá, {$name}!");
});

Deno.test("stringify - adds keys to existing and new sections", () => {
  const original = `# Resource
---

[cart]
title = Cart

# This remains attached to the next section.
[profile]
title = Profile
`;

  const result = stringify(
    new Map([
      ["cart.checkout", "Checkout"],
      ["errors.required", "Required"],
    ]),
    { original },
  );
  const messages = flatten(parse(result));

  assertEquals(messages.get("cart.checkout")?.message, "Checkout");
  assertEquals(messages.get("errors.required")?.message, "Required");
  assertEquals(
    result.includes("[cart]\ntitle = Cart\ncheckout = Checkout"),
    true,
  );
  assertEquals(
    result.includes("# This remains attached to the next section.\n[profile]"),
    true,
  );
  assertEquals(result.includes("[errors]\nrequired = Required"), true);
});

Deno.test("stringify - keeps last-section additions before appended sections", () => {
  const original = `---
[cart]
title = Cart`;
  const result = stringify(
    {
      "cart.checkout": "Checkout",
      "errors.required": "Required",
    },
    { original },
  );

  assertEquals(
    result,
    `---
[cart]
title = Cart
checkout = Checkout

[errors]
required = Required
`,
  );
  assertEquals([...flatten(parse(result)).keys()], [
    "cart.title",
    "cart.checkout",
    "errors.required",
  ]);
});

Deno.test("stringify - creates a resource with top-level entries first", () => {
  const result = stringify([
    ["errors.required", "Required"],
    ["hello", "Hello"],
    ["errors.network.timeout", "Timed out"],
  ]);

  assertEquals(
    result,
    `---

hello = Hello

[errors]
required = Required

[errors.network]
timeout = Timed out
`,
  );
  assertEquals(
    flatten(parse(result)),
    new Map([
      ["hello", { message: "Hello", metadata: {} }],
      ["errors.required", { message: "Required", metadata: {} }],
      ["errors.network.timeout", { message: "Timed out", metadata: {} }],
    ]),
  );
});

Deno.test("stringify - writes locale metadata in a new resource", () => {
  const result = stringify({ hello: "Olá" }, { locale: "pt-BR" });

  assertEquals(
    result,
    `@locale pt-BR
---

hello = Olá
`,
  );
  assertEquals(parse(result).meta, [{ key: "locale", value: "pt-BR" }]);
});

Deno.test("stringify - rejects positional options", () => {
  assertThrows(
    () =>
      stringify(
        { hello: "Hello" },
        "---\nhello = Hello\n" as never,
      ),
    TypeError,
    "Stringify options must be an object",
  );
});

Deno.test("stringify - rejects a parsed resource as original", () => {
  assertThrows(
    () =>
      stringify(
        { hello: "Hello" },
        { original: parse("---\nhello = Hello\n") as never },
      ),
    TypeError,
    "Original resource must be a string",
  );
});

Deno.test("stringify - inserts locale metadata into an existing resource", () => {
  const original = `# Resource comment
---
hello = Hello
`;
  const result = stringify(
    { hello: "Bonjour" },
    { original, locale: "fr" },
  );

  assertEquals(
    result,
    `# Resource comment
@locale fr
---
hello = Bonjour
`,
  );
  assertEquals(parse(result).comment, "Resource comment");
});

Deno.test("stringify - preserves formatting around existing locale metadata", () => {
  const original = [
    "# Resource comment",
    "@locale   en-US",
    "@version 1.0",
    "---",
    "hello = Hello",
    "",
  ].join("\r\n");
  const result = stringify({}, { original, locale: "pt-BR" });

  assertEquals(result, original.replace("en-US", "pt-BR"));
});

Deno.test("stringify - adds frontmatter when only locale changes", () => {
  const original = `hello = Hello
`;
  const result = stringify({}, { original, locale: "de" });

  assertEquals(
    result,
    `@locale de
---
hello = Hello
`,
  );
  assertEquals(flatten(parse(result)).get("hello")?.metadata.locale, "de");
});

Deno.test("stringify - expands Arabic plural categories", () => {
  const original = `@locale en
---

[cart]
@param $count - Number of items
items =
  .input {$count :integer}
  .match $count
  one {{عنصر واحد}}
  *   {{عناصر}}
`;

  const input = flatten(parse(original));
  const result = stringify(input, { original, locale: "ar" });
  const message = flatten(parse(result)).get("cart.items")?.message ?? "";

  assertEquals(message.includes("zero   {{عناصر}}"), true);
  assertEquals(message.includes("one {{عنصر واحد}}"), true);
  assertEquals(message.includes("two   {{عناصر}}"), true);
  assertEquals(message.includes("few   {{عناصر}}"), true);
  assertEquals(message.includes("many   {{عناصر}}"), true);
  assertEquals(message.includes("*   {{عناصر}}"), true);
  assertEquals(result.startsWith("@locale ar\n---\n\n[cart]\n@param"), true);
});

Deno.test("stringify - preserves escaped values when unchanged", () => {
  const original = `---
escaped = A \\n newline, a \\t tab, and MF2 \\{ \\| \\}
`;
  assertEquals(
    stringify(flatten(parse(original)), { original }),
    original,
  );
});

Deno.test("stringify - replaces a value that used a source line continuation", () => {
  const original = `---
message = A long \\
  message.
`;
  const result = stringify({ message: "Short." }, { original });
  assertEquals(
    result,
    `---
message = Short.
`,
  );
  assertEquals(flatten(parse(result)).get("message")?.message, "Short.");
});
