import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function resolveWorkspaceSlug(context = {}, actionInput = null) {
  const sourceContext = context && typeof context === "object" ? context : {};
  const sourceInput = actionInput && typeof actionInput === "object" && !Array.isArray(actionInput) ? actionInput : {};

  const candidates = [
    sourceContext?.workspace?.slug,
    sourceContext?.requestMeta?.resolvedWorkspaceContext?.workspace?.slug,
    sourceInput.workspaceSlug,
    sourceContext?.requestMeta?.request?.input?.params?.workspaceSlug
  ];

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate).toLowerCase();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

export { resolveWorkspaceSlug };
