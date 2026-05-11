import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(packageRoot, "templates/app/AGENTS.md");

test("app agent template points to jskit session instead of old prose workflows", async () => {
  const body = await readFile(templatePath, "utf8");

  assert.match(body, /jskit session create/);
  assert.match(body, /jskit session <session_id> step/);
  assert.match(body, /--json/);
  assert.match(body, /Do not invent a parallel manual issue workflow/);

  assert.doesNotMatch(body, /workflow\/app-state\.md/);
  assert.doesNotMatch(body, /workflow\/feature-delivery\.md/);
  assert.doesNotMatch(body, /Mandatory Start Gate/);
  assert.doesNotMatch(body, /Mandatory Done Gate/);
  assert.doesNotMatch(body, /WORKBOARD/);
});
