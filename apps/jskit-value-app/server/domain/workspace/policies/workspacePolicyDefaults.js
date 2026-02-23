import { TRANSCRIPT_MODE_STANDARD } from "../../../lib/aiTranscriptMode.js";

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
