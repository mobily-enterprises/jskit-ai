const TRANSCRIPT_MODE_STANDARD = "standard";
const TRANSCRIPT_MODE_RESTRICTED = "restricted";
const TRANSCRIPT_MODE_DISABLED = "disabled";

const TRANSCRIPT_MODE_VALUES = Object.freeze([
  TRANSCRIPT_MODE_STANDARD,
  TRANSCRIPT_MODE_RESTRICTED,
  TRANSCRIPT_MODE_DISABLED
]);

function normalizeTranscriptMode(value, fallback = TRANSCRIPT_MODE_STANDARD) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (TRANSCRIPT_MODE_VALUES.includes(normalized)) {
    return normalized;
  }

  return normalizeTranscriptMode(fallback, TRANSCRIPT_MODE_STANDARD);
}

function resolveTranscriptModeFromWorkspaceSettings(workspaceSettings) {
  const features =
    workspaceSettings?.features && typeof workspaceSettings.features === "object" ? workspaceSettings.features : {};
  const aiFeatures = features.ai && typeof features.ai === "object" ? features.ai : {};
  return normalizeTranscriptMode(aiFeatures.transcriptMode, TRANSCRIPT_MODE_STANDARD);
}

function applyTranscriptModeToWorkspaceFeatures(features, transcriptMode) {
  const currentFeatures = features && typeof features === "object" ? features : {};
  const currentAiFeatures = currentFeatures.ai && typeof currentFeatures.ai === "object" ? currentFeatures.ai : {};

  return {
    ...currentFeatures,
    ai: {
      ...currentAiFeatures,
      transcriptMode: normalizeTranscriptMode(transcriptMode, TRANSCRIPT_MODE_STANDARD)
    }
  };
}

export {
  TRANSCRIPT_MODE_STANDARD,
  TRANSCRIPT_MODE_RESTRICTED,
  TRANSCRIPT_MODE_DISABLED,
  TRANSCRIPT_MODE_VALUES,
  normalizeTranscriptMode,
  resolveTranscriptModeFromWorkspaceSettings,
  applyTranscriptModeToWorkspaceFeatures
};
