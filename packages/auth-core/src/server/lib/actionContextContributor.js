import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { normalizePermissionList } from "@jskit-ai/kernel/shared/support/permissions";

function createAuthActionContextContributor() {
  function contribute({ context }) {
    const request = resolveRequest(context);
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

  return Object.freeze({ contributorId: "auth.policy.request-context", contribute });
}

export { createAuthActionContextContributor };
