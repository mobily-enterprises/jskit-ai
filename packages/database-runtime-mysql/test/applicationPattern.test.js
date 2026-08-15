import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patternUrl = new URL("../patterns/mysql-application/", import.meta.url);

test("MySQL application pattern is driver-fixed and questionnaire-free", async () => {
  const [document, manifestSource, knexfile] = await Promise.all([
    readFile(new URL("PATTERN.md", patternUrl), "utf8"),
    readFile(new URL("example/package.json", patternUrl), "utf8"),
    readFile(new URL("example/knexfile.js", patternUrl), "utf8")
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.dependencies["@jskit-ai/database-runtime-mysql"], "0.1.157");
  assert.match(knexfile, /client: "mysql2"/u);
  assert.doesNotMatch(`${document}\n${knexfile}`, /promptLabel|promptHint|\$\{option:/u);
});
