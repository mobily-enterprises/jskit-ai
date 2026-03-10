import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizePermissions(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((entry) => normalizeText(entry)).filter(Boolean);
}

function createAuthActionContextContributor() {
  return Object.freeze({
    contributorId: "auth.policy.request-context",
    contribute({ request } = {}) {
      const contribution = {};
      const permissions = normalizePermissions(request?.permissions);

      if (request?.user) {
        contribution.actor = request.user;
      }

      if (request?.workspace) {
        contribution.workspace = request.workspace;
      }

      if (request?.membership) {
        contribution.membership = request.membership;
      }

      if (permissions.length > 0) {
        contribution.permissions = permissions;
      }

      return contribution;
    }
  });
}

export { createAuthActionContextContributor };
