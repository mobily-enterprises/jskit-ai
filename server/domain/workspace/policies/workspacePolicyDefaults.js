import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../../../../shared/settings/index.js";
import { TRANSCRIPT_MODE_STANDARD } from "../../../lib/aiTranscriptMode.js";

const DEFAULT_WORKSPACE_POLICY = {
  defaultMode: "fv",
  defaultTiming: "ordinary",
  defaultPaymentsPerYear: 12,
  defaultHistoryPageSize: 10
};

function resolveWorkspaceDefaults(policy) {
  const normalizedPolicy = policy && typeof policy === "object" ? policy : {};

  const defaultModeCandidate = String(normalizedPolicy.defaultMode || "")
    .trim()
    .toLowerCase();
  const defaultTimingCandidate = String(normalizedPolicy.defaultTiming || "")
    .trim()
    .toLowerCase();
  const defaultPaymentsPerYearCandidate = Number(normalizedPolicy.defaultPaymentsPerYear);
  const defaultHistoryPageSizeCandidate = Number(normalizedPolicy.defaultHistoryPageSize);

  return {
    defaultMode: SETTINGS_MODE_OPTIONS.includes(defaultModeCandidate)
      ? defaultModeCandidate
      : DEFAULT_WORKSPACE_POLICY.defaultMode,
    defaultTiming: SETTINGS_TIMING_OPTIONS.includes(defaultTimingCandidate)
      ? defaultTimingCandidate
      : DEFAULT_WORKSPACE_POLICY.defaultTiming,
    defaultPaymentsPerYear:
      Number.isInteger(defaultPaymentsPerYearCandidate) &&
      defaultPaymentsPerYearCandidate >= 1 &&
      defaultPaymentsPerYearCandidate <= 365
        ? defaultPaymentsPerYearCandidate
        : DEFAULT_WORKSPACE_POLICY.defaultPaymentsPerYear,
    defaultHistoryPageSize:
      Number.isInteger(defaultHistoryPageSizeCandidate) &&
      defaultHistoryPageSizeCandidate >= 1 &&
      defaultHistoryPageSizeCandidate <= 100
        ? defaultHistoryPageSizeCandidate
        : DEFAULT_WORKSPACE_POLICY.defaultHistoryPageSize
  };
}

function createWorkspaceSettingsDefaults(invitesEnabled = false) {
  return {
    invitesEnabled: Boolean(invitesEnabled),
    features: {
      ai: {
        transcriptMode: TRANSCRIPT_MODE_STANDARD
      }
    },
    policy: { ...DEFAULT_WORKSPACE_POLICY }
  };
}

export { DEFAULT_WORKSPACE_POLICY, resolveWorkspaceDefaults, createWorkspaceSettingsDefaults };
