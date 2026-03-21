import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePermissionList } from "@jskit-ai/kernel/shared/support/permissions";

function createAuthActionContextContributor() {
  return Object.freeze({
    contributorId: "auth.policy.request-context",
    contribute({ request } = {}) {
      const contribution = {};
      const permissions = normalizePermissionList(request?.permissions);

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
