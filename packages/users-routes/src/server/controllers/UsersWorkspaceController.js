const WORKSPACE_ACTION_IDS = Object.freeze({
  AUTH_SESSION_READ: "auth.session.read",
  BOOTSTRAP_READ: "workspace.bootstrap.read",
  WORKSPACES_LIST: "workspace.workspaces.list",
  SELECT: "workspace.select",
  INVITATIONS_PENDING_LIST: "workspace.invitations.pending.list",
  INVITE_REDEEM: "workspace.invite.redeem",
  ROLES_LIST: "workspace.roles.list",
  SETTINGS_READ: "workspace.settings.read",
  SETTINGS_UPDATE: "workspace.settings.update",
  MEMBERS_LIST: "workspace.members.list",
  MEMBER_ROLE_UPDATE: "workspace.member.role.update",
  INVITES_LIST: "workspace.invites.list",
  INVITE_CREATE: "workspace.invite.create",
  INVITE_REVOKE: "workspace.invite.revoke"
});

function normalizeText(value) {
  return String(value || "").trim();
}

async function executeAction(actionExecutor, { actionId, request, input = {}, context = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api",
      ...(context && typeof context === "object" ? context : {})
    }
  });
}

function getOAuthProviderCatalogPayload(authService) {
  if (!authService || typeof authService.getOAuthProviderCatalog !== "function") {
    return {
      oauthProviders: [],
      oauthDefaultProvider: null
    };
  }

  const catalog = authService.getOAuthProviderCatalog();
  const providers = Array.isArray(catalog?.providers)
    ? catalog.providers
        .map((provider) => ({
          id: normalizeText(provider?.id).toLowerCase(),
          label: normalizeText(provider?.label)
        }))
        .filter((provider) => provider.id && provider.label)
    : [];
  const defaultProvider = normalizeText(catalog?.defaultProvider).toLowerCase();

  return {
    oauthProviders: providers,
    oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider) ? defaultProvider : null
  };
}

class UsersWorkspaceController {
  constructor({ authService, actionExecutor, consoleService = null } = {}) {
    if (!authService) {
      throw new Error("UsersWorkspaceController requires authService.");
    }
    if (!actionExecutor || typeof actionExecutor.execute !== "function") {
      throw new Error("UsersWorkspaceController requires actionExecutor.execute().");
    }

    this.authService = authService;
    this.actionExecutor = actionExecutor;
    this.consoleService = consoleService;
  }

  async bootstrap(request, reply) {
    const oauthCatalogPayload = getOAuthProviderCatalogPayload(this.authService);

    const authResult = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.AUTH_SESSION_READ,
      request
    });

    if (authResult?.clearSession === true && typeof this.authService.clearSessionCookies === "function") {
      this.authService.clearSessionCookies(reply);
    }
    if (authResult?.session && typeof this.authService.writeSessionCookies === "function") {
      this.authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult?.transientFailure === true) {
      reply.code(503).send({
        error: "Authentication service temporarily unavailable. Please retry."
      });
      return;
    }

    if (
      authResult?.authenticated &&
      authResult?.profile?.id != null &&
      this.consoleService &&
      typeof this.consoleService.ensureInitialConsoleMember === "function"
    ) {
      await this.consoleService.ensureInitialConsoleMember(authResult.profile.id);
    }

    const payload = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.BOOTSTRAP_READ,
      request,
      input: {
        user: authResult?.authenticated ? authResult.profile : null
      },
      context: {
        actor: authResult?.authenticated ? authResult.profile : null
      }
    });

    const session = payload?.session && typeof payload.session === "object" ? payload.session : { authenticated: false };

    reply.code(200).send({
      ...payload,
      session: {
        ...session,
        ...oauthCatalogPayload
      }
    });
  }

  async listWorkspaces(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.WORKSPACES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async selectWorkspace(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SELECT,
      request,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async listPendingInvites(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITATIONS_PENDING_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async respondToPendingInviteByToken(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_REDEEM,
      request,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async getWorkspaceSettings(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SETTINGS_READ,
      request
    });
    reply.code(200).send(response);
  }

  async updateWorkspaceSettings(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SETTINGS_UPDATE,
      request,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async listWorkspaceRoles(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.ROLES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async listWorkspaceMembers(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.MEMBERS_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async updateWorkspaceMemberRole(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.MEMBER_ROLE_UPDATE,
      request,
      input: {
        memberUserId: request.input.params.memberUserId,
        roleId: request.input.body.roleId
      }
    });
    reply.code(200).send(response);
  }

  async listWorkspaceInvites(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async createWorkspaceInvite(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_CREATE,
      request,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async revokeWorkspaceInvite(request, reply) {
    const response = await executeAction(this.actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_REVOKE,
      request,
      input: {
        inviteId: request.input.params.inviteId
      }
    });
    reply.code(200).send(response);
  }
}

export { UsersWorkspaceController, WORKSPACE_ACTION_IDS };
