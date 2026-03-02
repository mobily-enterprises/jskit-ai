import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const AUDIT_LIST_PATH = path.join(APP_ROOT, "audit", "auditList.md");
const PROMPT_03_PATH = path.join(APP_ROOT, "audit", "premade-prompts", "03.md");
const DOMAIN_03_HEADER = "## 03) Auth provider and session pipeline";
const REQUIRED_RUNTIME_SCOPE_PATH = "/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src";

function readFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function extractEntry(markdown, header) {
  const entryStart = markdown.indexOf(header);
  assert.notEqual(entryStart, -1, `Missing audit entry header: ${header}`);

  const nextHeaderStart = markdown.indexOf("\n## ", entryStart + header.length);
  if (nextHeaderStart === -1) {
    return markdown.slice(entryStart);
  }
  return markdown.slice(entryStart, nextHeaderStart);
}

test("auditList domain 03 required scope includes runtime auth package source", () => {
  const auditList = readFile(AUDIT_LIST_PATH);
  const domain03Entry = extractEntry(auditList, DOMAIN_03_HEADER);

  assert.equal(
    domain03Entry.includes(`- \`${REQUIRED_RUNTIME_SCOPE_PATH}\``),
    true,
    "Domain 03 required scope must include auth-provider-supabase-core runtime source path."
  );
});

test("premade prompt 03 keeps required runtime auth package source in scope", () => {
  const prompt = readFile(PROMPT_03_PATH);

  assert.equal(
    prompt.includes(`- \`${REQUIRED_RUNTIME_SCOPE_PATH}\``),
    true,
    "premade-prompts/03.md must include auth-provider-supabase-core runtime source path."
  );
});
