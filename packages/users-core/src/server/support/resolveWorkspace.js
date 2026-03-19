import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function resolveRequest(context = {}) {
  const requestMeta = normalizeObject(context?.requestMeta);
  return normalizeObject(requestMeta.request);
}

function resolveWorkspace(context = {}, input = {}) {
  const payload = normalizeObject(input);
  const requestMeta = normalizeObject(context?.requestMeta);
  const resolvedWorkspaceContext = normalizeObject(requestMeta.resolvedWorkspaceContext);

  return payload.workspace || resolvedWorkspaceContext.workspace || context?.workspace || resolveRequest(context)?.workspace || null;
}

export { resolveWorkspace };
