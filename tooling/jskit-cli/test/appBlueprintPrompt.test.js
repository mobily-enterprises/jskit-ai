import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("app blueprint prompt distinguishes canonical ownership from domain relationships", async () => {
  const prompt = await readFile(
    path.join(packageRoot, "src/server/prompts/app_blueprint.md"),
    "utf8"
  );

  assert.match(prompt, /exact columns `workspace_id` and `user_id` as standard JSKIT ownership/);
  assert.match(prompt, /require the selected ownership filter to match those columns exactly/);
  assert.match(prompt, /`recipient_user_id`/);
  assert.match(prompt, /domain relationships, not ownership aliases/);
  assert.match(prompt, /Never rename a domain relationship to an ownership column to satisfy tooling/);
});
