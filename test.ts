import { assertEquals } from "@std/assert";
import { flatten, parse } from "./mod.ts";

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
