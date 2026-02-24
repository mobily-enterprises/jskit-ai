import { TRANSCRIPT_MODE_STANDARD } from "@jskit-ai/assistant-transcripts-core";

function createWorkspaceSettingsDefaults(invitesEnabled = false) {
  return {
    invitesEnabled: Boolean(invitesEnabled),
    features: {
      ai: {
        transcriptMode: TRANSCRIPT_MODE_STANDARD
      }
    },
    policy: {}
  };
}

export { createWorkspaceSettingsDefaults };
