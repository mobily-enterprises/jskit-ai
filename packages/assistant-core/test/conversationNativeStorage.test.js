import assert from "node:assert/strict";
import test from "node:test";
import { nativeConversationStoragePolicy } from "../src/server/conversation/nativeStorage.js";

test("native storage policy distinguishes locked deletion from host writer exclusion", () => {
  assert.equal(nativeConversationStoragePolicy("codex").requiresWriterExclusion, false);
  assert.equal(nativeConversationStoragePolicy("claude").requiresWriterExclusion, true);
  assert.equal(nativeConversationStoragePolicy("claude").allowsManagedServer, false);
  assert.equal(nativeConversationStoragePolicy("opencode").requiresWriterExclusion, true);
  assert.equal(nativeConversationStoragePolicy("opencode").allowsManagedServer, true);
  for (const engine of ["api", "unknown", "toString", "__proto__", undefined]) {
    assert.throws(() => nativeConversationStoragePolicy(engine), /Unsupported/u);
  }
});

test("native writer recognition handles executables and node entry points without matching similar names", () => {
  const claude = nativeConversationStoragePolicy("claude");
  assert.ok(claude.matchesProcess({ executable: "/tools/claude", commandLine: "native\0--resume\0" }));
  assert.ok(claude.matchesProcess({ executable: "/usr/bin/node", commandLine: "node\0/tools/node_modules/@anthropic-ai/claude-code/cli.js\0" }));
  assert.equal(claude.matchesProcess({ executable: "/tools/claude-helper", commandLine: "node\0/notes/claude.txt\0" }), false);
  const opencode = nativeConversationStoragePolicy("opencode");
  assert.ok(opencode.matchesProcess({ executable: "/tools/opencode", commandLine: "opencode\0serve\0" }));
  assert.ok(opencode.matchesProcess({ executable: "/usr/bin/bun", commandLine: "bun\0/tools/opencode\0serve\0" }));
  assert.equal(opencode.matchesProcess({ executable: "/tools/opencode-helper", commandLine: "node\0/notes/opencode.txt\0" }), false);
});
