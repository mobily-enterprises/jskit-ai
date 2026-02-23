import { AppError } from "../../../lib/errors.js";
import {
  AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH,
  applyAssistantSystemPromptWorkspaceToConsoleFeatures,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings
} from "../../../lib/aiAssistantSystemPrompt.js";
import {
  CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS,
  CONSOLE_MANAGEMENT_PERMISSIONS,
  getRoleCatalog,
  normalizeRoleId,
  resolveAssignableRoleIds
} from "../policies/roles.js";
import {
  DEFAULT_BILLING_PROVIDER,
  resolveBillingProvider
} from "./billingCatalog.service.js";
import { createConsoleAccessService } from "./consoleAccess.service.js";
import { createConsoleBillingService } from "./consoleBilling.service.js";
import { createConsoleMembersService } from "./consoleMembers.service.js";
import { createConsoleInvitesService } from "./consoleInvites.service.js";

function createService({
  consoleMembershipsRepository,
  consoleInvitesRepository,
  consoleRootRepository,
  consoleSettingsRepository,
  userProfilesRepository,
  billingRepository = null,
  billingProviderAdapter = null,
  billingEnabled = true,
  billingProvider = DEFAULT_BILLING_PROVIDER
}) {
  if (
    !consoleMembershipsRepository ||
    !consoleInvitesRepository ||
    !consoleRootRepository ||
    !consoleSettingsRepository ||
    !userProfilesRepository
  ) {
    throw new Error("console service repositories are required.");
  }

  const roleCatalog = getRoleCatalog();
  const assignableRoleIds = resolveAssignableRoleIds();
  const activeBillingProvider = resolveBillingProvider(billingProvider);

  async function runInInviteTransaction(work) {
    if (typeof consoleInvitesRepository.transaction === "function") {
      return consoleInvitesRepository.transaction(work);
    }

    return work(null);
  }

  async function ensureConsoleSettings(options = {}) {
    if (typeof consoleSettingsRepository.ensure !== "function") {
      throw new Error("consoleSettingsRepository.ensure is required.");
    }

    return consoleSettingsRepository.ensure(options);
  }

  function normalizeAssistantSystemPromptWorkspace(value) {
    if (value == null) {
      return "";
    }

    const normalized = String(value || "").trim();
    if (normalized.length <= AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH) {
      return normalized;
    }

    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          assistantSystemPromptWorkspace: `assistantSystemPromptWorkspace must be at most ${AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH} characters.`
        }
      }
    });
  }

  function mapAssistantSettingsResponse(consoleSettings) {
    return {
      settings: {
        assistantSystemPromptWorkspace: resolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings)
      }
    };
  }

  function normalizeRoleForAssignment(roleId) {
    const normalizedRole = normalizeRoleId(roleId);
    if (!normalizedRole) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is required."
          }
        }
      });
    }

    if (!assignableRoleIds.includes(normalizedRole)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    return normalizedRole;
  }

  let resolvePendingInvitesForUser = async () => [];

  const {
    ensureRootMutationAllowed,
    ensureInitialConsoleMember,
    resolveRequestContext,
    requireConsoleAccess,
    requirePermission
  } = createConsoleAccessService({
    consoleMembershipsRepository,
    consoleRootRepository,
    listPendingInvitesForUser: (user) => resolvePendingInvitesForUser(user)
  });

  const {
    listMembers,
    updateMemberRole
  } = createConsoleMembersService({
    requirePermission,
    consoleMembershipsRepository,
    roleCatalog,
    normalizeRoleForAssignment,
    ensureRootMutationAllowed
  });

  const {
    listPendingInvitesForUser,
    listInvites,
    createInvite,
    revokeInvite,
    respondToPendingInviteByToken
  } = createConsoleInvitesService({
    requirePermission,
    runInInviteTransaction,
    consoleInvitesRepository,
    consoleMembershipsRepository,
    userProfilesRepository,
    roleCatalog,
    normalizeRoleForAssignment
  });
  resolvePendingInvitesForUser = listPendingInvitesForUser;

  const {
    getBillingSettings,
    updateBillingSettings,
    listBillingEvents,
    listBillingPlans,
    listBillingProducts,
    createBillingPlan,
    createBillingProduct,
    listBillingProviderPrices,
    updateBillingPlan,
    updateBillingProduct
  } = createConsoleBillingService({
    requirePermission,
    ensureConsoleSettings,
    consoleSettingsRepository,
    billingEnabled,
    billingRepository,
    billingProviderAdapter,
    activeBillingProvider
  });

  async function buildBootstrapPayload({ user }) {
    if (!user) {
      return {
        session: {
          authenticated: false
        },
        membership: null,
        permissions: [],
        roleCatalog,
        pendingInvites: [],
        isConsole: false
      };
    }

    const context = await resolveRequestContext({ user });

    return {
      session: {
        authenticated: true,
        userId: Number(user.id),
        username: user.displayName || null
      },
      membership: context.membership,
      permissions: context.permissions,
      roleCatalog,
      pendingInvites: context.pendingInvites,
      isConsole: context.hasAccess
    };
  }

  async function listRoles(user) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.ROLES_VIEW);
    return {
      roleCatalog
    };
  }

  async function getAssistantSettings(user) {
    await requireConsoleAccess(user);
    const consoleSettings = await ensureConsoleSettings();
    return mapAssistantSettingsResponse(consoleSettings);
  }

  async function updateAssistantSettings(user, payload) {
    await requirePermission(user, CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS.MANAGE);
    const body = payload && typeof payload === "object" ? payload : {};

    if (!Object.hasOwn(body, "assistantSystemPromptWorkspace")) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            assistantSystemPromptWorkspace: "assistantSystemPromptWorkspace is required."
          }
        }
      });
    }

    const normalizedPrompt = normalizeAssistantSystemPromptWorkspace(body.assistantSystemPromptWorkspace);
    const currentSettings = await ensureConsoleSettings();
    const baseFeatures = currentSettings?.features && typeof currentSettings.features === "object" ? currentSettings.features : {};
    const nextFeatures = applyAssistantSystemPromptWorkspaceToConsoleFeatures(baseFeatures, normalizedPrompt);

    const updatedSettings = await consoleSettingsRepository.update({
      features: nextFeatures
    });

    return mapAssistantSettingsResponse(updatedSettings);
  }

  return {
    ensureInitialConsoleMember,
    resolveRequestContext,
    buildBootstrapPayload,
    listPendingInvitesForUser,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    respondToPendingInviteByToken,
    listRoles,
    getAssistantSettings,
    updateAssistantSettings,
    getBillingSettings,
    updateBillingSettings,
    listBillingEvents,
    listBillingPlans,
    listBillingProducts,
    createBillingPlan,
    createBillingProduct,
    listBillingProviderPrices,
    updateBillingPlan,
    updateBillingProduct
  };
}

export { createService };
