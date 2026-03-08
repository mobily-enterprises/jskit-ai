import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizePermissions(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((entry) => normalizeText(entry)).filter(Boolean);
}

function createAuthActionContextContributor() {
  return Object.freeze({
    contributorId: "auth.policy.request-context",
    contribute({ request } = {}) {
      return {
        actor: request?.user || null,
        workspace: request?.workspace || null,
        membership: request?.membership || null,
        permissions: normalizePermissions(request?.permissions)
      };
    }
  });
}

export { createAuthActionContextContributor };
