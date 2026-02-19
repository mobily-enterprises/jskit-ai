import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("README includes realtime inventory exemption note outside API contracts marker block", () => {
  const readmePath = new URL("../README.md", import.meta.url);
  const readme = readFileSync(readmePath, "utf8");

  const note =
    "`GET /api/realtime` is intentionally outside the generated API contracts inventory (`buildDefaultRoutes` path).";
  const startMarker = "<!-- API_CONTRACTS_START -->";
  const endMarker = "<!-- API_CONTRACTS_END -->";

  const noteIndex = readme.indexOf(note);
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);

  assert.notEqual(noteIndex, -1, "README missing realtime contracts inventory note.");
  assert.notEqual(startIndex, -1, "README missing API contracts start marker.");
  assert.notEqual(endIndex, -1, "README missing API contracts end marker.");
  assert.equal(noteIndex < startIndex || noteIndex > endIndex, true, "Realtime note must be outside API marker block.");
  assert.equal(readme.includes("WS_ARCHITECTURE.md"), true, "README missing WS_ARCHITECTURE.md pointer.");
});
