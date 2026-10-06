import {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  createCodexHelperThreadLedgerOwner
} from "../../src/server/conversation/codexHelperThreadLedger.js";

// This is the original test's resolved profile data, not application policy.
// Public keeps and tests its original strict codec against its own catalogue.
function helperProfile() {
  return {
    limits: { maxInputCharacters: 100_000, maxOutputCharacters: 32_000, timeoutMs: 180_000 },
    model: "gpt-5.6-luna",
    policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
    profileId: "helper",
    providerId: "codex",
    request: { allowProviderModelFallback: false, reasoning: true, summary: false },
    revision: "codex-helper-luna-low-v2",
    thinking: "low",
    workloadId: "source_explanation"
  };
}

const {
  codexHelperThreadRecordId,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord
} = createCodexHelperThreadLedgerOwner({
  executionProfile: value => structuredClone(value),
  errorPrefix: "vibe64_codex_helper_"
});

export {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  codexHelperThreadRecordId,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord,
  helperProfile
};
