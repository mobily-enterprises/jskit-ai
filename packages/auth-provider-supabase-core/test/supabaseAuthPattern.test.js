import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Supabase auth pattern uses ordinary configuration without prompts", async () => {
  const root = new URL("../patterns/supabase-auth/", import.meta.url);
  const source = await Promise.all([
    readFile(new URL("PATTERN.md", root), "utf8"),
    readFile(new URL("example/.env.example", root), "utf8"),
    readFile(new URL("example/config/server.js", root), "utf8")
  ]).then((parts) => parts.join("\n"));

  assert.match(source, /AUTH_SUPABASE_URL/u);
  assert.match(source, /profileMode: "provider"/u);
  assert.doesNotMatch(source, /promptLabel|promptHint|\$\{option:/u);
});
