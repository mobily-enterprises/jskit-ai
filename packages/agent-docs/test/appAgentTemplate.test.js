import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(packageRoot, "templates/app/AGENTS.md");

test("app agent template points to public framework docs without requiring agent-docs", async () => {
  const body = await readFile(templatePath, "utf8");

  assert.match(body, /https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\//u);
  assert.match(body, /https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/patterns\//u);
  assert.match(body, /prefer that version-matched package-owned copy/u);
  assert.match(body, /Do not install an unrelated runtime package only to read documentation/u);
  assert.match(body, /Do not add generator\s+provenance, receipts/u);
  assert.doesNotMatch(body, /node_modules\/@jskit-ai\/agent-docs/u);

  assert.doesNotMatch(body, /local app scaffold/u);
  assert.doesNotMatch(body, /crud-scaffolding\.md/u);
  assert.doesNotMatch(body, /workflow\/app-state\.md/);
  assert.doesNotMatch(body, /workflow\/feature-delivery\.md/);
  assert.doesNotMatch(body, /Mandatory Start Gate/);
  assert.doesNotMatch(body, /Mandatory Done Gate/);
});
