import { deepEqual } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { flatten, parse } from "./dist/mod.js";

const testsDir = join(dirname(fileURLToPath(import.meta.url)), "tests");

for (const entry of await readdir(testsDir)) {
  if (entry.endsWith(".mfr")) {
    const testName = entry.replace(/\.mfr$/, "");

    test(testName, async () => {
      const input = await readFile(join(testsDir, entry), "utf8");
      const expected = JSON.parse(
        await readFile(join(testsDir, `${testName}.json`), "utf8"),
      );

      deepEqual(parse(input), expected);
    });
  }
}

test("flatten preserves metadata inheritance", () => {
  const resource = parse(`
@locale en-US
---
@param $name - The user's name
hello = Hello, {$name}!

@author translations-team
[errors]
required = This field is required.
`);

  deepEqual(flatten(resource), new Map([
    ["hello", {
      message: "Hello, {$name}!",
      metadata: { locale: "en-US", param: "$name - The user's name" },
    }],
    ["errors.required", {
      message: "This field is required.",
      metadata: { locale: "en-US", author: "translations-team" },
    }],
  ]));
});
