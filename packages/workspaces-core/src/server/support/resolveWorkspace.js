import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * The workspace an action runs in: the input's workspace, else the one the
 * workspace context contributor resolved, else the context's or the request's.
 * @param {object} context
 * @param {unknown} [input]
 */
function resolveWorkspace(context = {}, input = {}) {
  const payload = normalizeObject(input);
  const requestMeta = normalizeObject(context?.requestMeta);
  const resolvedWorkspaceContext = normalizeObject(requestMeta.resolvedWorkspaceContext);

  return payload.workspace || resolvedWorkspaceContext.workspace || context?.workspace || resolveRequest(context)?.workspace || null;
}

export { resolveWorkspace };
