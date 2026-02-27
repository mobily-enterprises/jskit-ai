import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCRIPT_MODE_DISABLED,
  TRANSCRIPT_MODE_RESTRICTED,
  TRANSCRIPT_MODE_STANDARD,
  applyTranscriptModeToWorkspaceFeatures,
  normalizeTranscriptMode,
  resolveTranscriptModeFromWorkspaceSettings
} from "../src/shared/mode.js";

test("mode helpers normalize and resolve transcript mode values", () => {
  assert.equal(normalizeTranscriptMode("STANDARD"), TRANSCRIPT_MODE_STANDARD);
  assert.equal(normalizeTranscriptMode("restricted"), TRANSCRIPT_MODE_RESTRICTED);
  assert.equal(normalizeTranscriptMode("invalid", TRANSCRIPT_MODE_DISABLED), TRANSCRIPT_MODE_DISABLED);

  assert.equal(
    resolveTranscriptModeFromWorkspaceSettings({
      features: { ai: { transcriptMode: "restricted" } }
    }),
    TRANSCRIPT_MODE_RESTRICTED
  );

  const patched = applyTranscriptModeToWorkspaceFeatures({ ai: { foo: true } }, "disabled");
  assert.equal(patched.ai.transcriptMode, TRANSCRIPT_MODE_DISABLED);
  assert.equal(patched.ai.foo, true);
});
