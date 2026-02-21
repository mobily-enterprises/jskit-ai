import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizePagination } from "../../../lib/primitives/pagination.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
import {
  AI_ASSISTANT_SYSTEM_PROMPT_MAX_LENGTH,
  applyAssistantSystemPromptWorkspaceToConsoleFeatures,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings
} from "../../../lib/aiAssistantSystemPrompt.js";
import { mapInvite, mapMember, mapMembershipSummary, mapPendingInvite } from "../mappers/consoleMappers.js";
import { resolveInviteExpiresAt } from "../policies/invitePolicy.js";
import {
  buildInviteToken,
  encodeInviteTokenHash,
  hashInviteToken,
  normalizeInviteToken,
  resolveInviteTokenHash
} from "../policies/inviteTokens.js";
import {
  CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS,
  CONSOLE_BILLING_PERMISSIONS,
  CONSOLE_MANAGEMENT_PERMISSIONS,
  CONSOLE_ROLE_ID,
  getRoleCatalog,
  hasPermission,
  normalizeRoleId,
  resolveAssignableRoleIds,
  resolveRolePermissions
} from "../policies/roles.js";
import {
  DEFAULT_BILLING_PROVIDER,
  resolveBillingProvider,
  normalizeBillingCatalogPlanCreatePayload,
  normalizeBillingCatalogPlanPricePatchPayload,
  mapBillingPlanDuplicateError,
  ensureBillingCatalogRepository,
  buildConsoleBillingPlanCatalog
} from "./billingCatalog.service.js";
import {
  resolveCatalogBasePriceForCreate,
  resolveCatalogPricePatchForUpdate
} from "./billingCatalogProviderPricing.service.js";

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

  function normalizeOptionalString(value) {
    const normalized = String(value || "").trim();
    return normalized || "";
  }

  async function runInTransaction(work) {
    if (typeof consoleMembershipsRepository.transaction === "function") {
      return consoleMembershipsRepository.transaction(work);
    }

    return work(null);
  }

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

  async function resolveRootUserId(options = {}) {
    const rootUserId = await consoleRootRepository.findRootUserId(options);
    return parsePositiveInteger(rootUserId) || null;
  }

  async function bootstrapRootIdentity(options = {}) {
    const existingRootUserId = await resolveRootUserId(options);
    if (existingRootUserId) {
      return existingRootUserId;
    }

    const activeConsoleMembership =
      typeof consoleMembershipsRepository.findActiveByRoleId === "function"
        ? await consoleMembershipsRepository.findActiveByRoleId(CONSOLE_ROLE_ID, options)
        : null;
    const activeConsoleUserId = parsePositiveInteger(activeConsoleMembership?.userId);
    if (!activeConsoleUserId) {
      return null;
    }

    await consoleRootRepository.assignRootUserIdIfUnset(activeConsoleUserId, options);
    return resolveRootUserId(options);
  }

  async function ensureRootMutationAllowed(actorUser, targetUserId) {
    const rootUserId = await resolveRootUserId();
    const normalizedTargetUserId = parsePositiveInteger(targetUserId);
    if (!rootUserId || !normalizedTargetUserId || normalizedTargetUserId !== rootUserId) {
      return;
    }

    const actorUserId = parsePositiveInteger(actorUser?.id);
    if (!actorUserId || actorUserId !== rootUserId) {
      throw new AppError(403, "Only root can modify the root user.");
    }
  }

  async function ensureInitialConsoleMember(userId) {
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return null;
    }

    return runInTransaction(async (trx) => {
      const transactionOptions = trx ? { trx } : {};
      const rootUserId = await bootstrapRootIdentity(transactionOptions);

      const existingMembership = await consoleMembershipsRepository.findByUserId(numericUserId, transactionOptions);
      if (existingMembership) {
        if (
          !rootUserId &&
          normalizeRoleId(existingMembership.roleId) === CONSOLE_ROLE_ID &&
          String(existingMembership.status || "").trim().toLowerCase() === "active"
        ) {
          await consoleRootRepository.assignRootUserIdIfUnset(numericUserId, transactionOptions);
        }
        return existingMembership;
      }

      const activeCount = await consoleMembershipsRepository.countActiveMembers(transactionOptions);
      if (activeCount > 0) {
        return null;
      }

      if (rootUserId && rootUserId !== numericUserId) {
        return null;
      }

      try {
        const membership = await consoleMembershipsRepository.insert(
          {
            userId: numericUserId,
            roleId: CONSOLE_ROLE_ID,
            status: "active"
          },
          transactionOptions
        );
        await consoleRootRepository.assignRootUserIdIfUnset(numericUserId, transactionOptions);
        return membership;
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }
      }

      const membership = await consoleMembershipsRepository.findByUserId(numericUserId, transactionOptions);
      if (
        membership &&
        normalizeRoleId(membership.roleId) === CONSOLE_ROLE_ID &&
        String(membership.status || "").trim().toLowerCase() === "active"
      ) {
        await consoleRootRepository.assignRootUserIdIfUnset(numericUserId, transactionOptions);
      }

      return membership;
    });
  }

  async function listPendingInvitesForUser(user) {
    const email = normalizeEmail(user?.email);
    if (!email) {
      return [];
    }

    const userId = parsePositiveInteger(user?.id);
    const membership = userId ? await consoleMembershipsRepository.findByUserId(userId) : null;
    if (membership && membership.status === "active") {
      return [];
    }

    const invites = await consoleInvitesRepository.listPendingByEmail(email);
    return invites
      .map((invite) =>
        mapPendingInvite({
          ...invite,
          token: encodeInviteTokenHash(invite?.tokenHash)
        })
      )
      .filter((invite) => Boolean(invite?.token));
  }

  async function resolveRequestContext({ user }) {
    const userId = parsePositiveInteger(user?.id);
    if (!userId) {
      return {
        membership: null,
        permissions: [],
        hasAccess: false,
        pendingInvites: []
      };
    }

    await ensureInitialConsoleMember(userId);

    const membership = await consoleMembershipsRepository.findByUserId(userId);
    const activeMembership = membership && membership.status === "active" ? membership : null;
    const permissions = activeMembership ? resolveRolePermissions(activeMembership.roleId) : [];
    const pendingInvites = activeMembership ? [] : await listPendingInvitesForUser(user);

    return {
      membership: mapMembershipSummary(activeMembership),
      permissions,
      hasAccess: Boolean(activeMembership),
      pendingInvites
    };
  }

  async function requireConsoleAccess(user) {
    const context = await resolveRequestContext({ user });
    if (!context.hasAccess) {
      throw new AppError(403, "Forbidden.");
    }

    return context;
  }

  async function requirePermission(user, permission) {
    const context = await requireConsoleAccess(user);
    if (!hasPermission(context.permissions, permission)) {
      throw new AppError(403, "Forbidden.");
    }

    return context;
  }

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

  async function listMembers(user) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW);
    const members = await consoleMembershipsRepository.listActive();

    return {
      members: members.map(mapMember).filter(Boolean),
      roleCatalog
    };
  }

  async function updateMemberRole(user, payload) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_MANAGE);

    const memberUserId = parsePositiveInteger(payload?.memberUserId);
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            memberUserId: "memberUserId is required."
          }
        }
      });
    }

    await ensureRootMutationAllowed(user, memberUserId);

    const roleId = normalizeRoleForAssignment(payload?.roleId);
    const existingMembership = await consoleMembershipsRepository.findByUserId(memberUserId);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }

    if (normalizeRoleId(existingMembership.roleId) === CONSOLE_ROLE_ID) {
      throw new AppError(409, "Cannot change the console super-user role.");
    }

    await consoleMembershipsRepository.updateRoleByUserId(memberUserId, roleId);
    return listMembers(user);
  }

  async function listInvites(user) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW);
    const invites = await consoleInvitesRepository.listPending();

    return {
      invites: invites.map(mapInvite).filter(Boolean),
      roleCatalog
    };
  }

  async function createInvite(user, payload) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.MEMBERS_INVITE);

    const email = normalizeEmail(payload?.email);
    if (!email) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            email: "Invite email is required."
          }
        }
      });
    }

    const roleId = normalizeRoleForAssignment(payload?.roleId || roleCatalog.defaultInviteRole);
    const existingUser = await userProfilesRepository.findByEmail(email);
    if (existingUser) {
      const existingMembership = await consoleMembershipsRepository.findByUserId(existingUser.id);
      if (existingMembership && existingMembership.status === "active") {
        throw new AppError(409, "User is already a console member.");
      }
    }

    const inviteToken = buildInviteToken();
    let createdInvite = null;

    await runInInviteTransaction(async (trx) => {
      const options = trx ? { trx } : {};
      await consoleInvitesRepository.expirePendingByEmail(email, options);

      try {
        createdInvite = await consoleInvitesRepository.insert(
          {
            email,
            roleId,
            tokenHash: hashInviteToken(inviteToken),
            invitedByUserId: Number(user?.id) || null,
            expiresAt: resolveInviteExpiresAt(),
            status: "pending"
          },
          options
        );
      } catch (error) {
        if (isMysqlDuplicateEntryError(error)) {
          throw new AppError(409, "A pending invite for this email already exists.");
        }

        throw error;
      }
    });

    const response = await listInvites(user);
    return {
      ...response,
      createdInvite: {
        inviteId: Number(createdInvite?.id),
        email,
        token: inviteToken
      }
    };
  }

  async function revokeInvite(user, inviteId) {
    await requirePermission(user, CONSOLE_MANAGEMENT_PERMISSIONS.INVITES_REVOKE);

    const numericInviteId = parsePositiveInteger(inviteId);
    if (!numericInviteId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            inviteId: "inviteId is required."
          }
        }
      });
    }

    const invite = await consoleInvitesRepository.findPendingById(numericInviteId);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await consoleInvitesRepository.revokeById(numericInviteId);
    return listInvites(user);
  }

  async function respondToPendingInviteByToken({ user, inviteToken, decision }) {
    const userId = parsePositiveInteger(user?.id);
    const email = normalizeEmail(user?.email);
    if (!userId || !email) {
      throw new AppError(401, "Authentication required.");
    }

    const normalizedDecision = String(decision || "")
      .trim()
      .toLowerCase();
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            decision: "decision must be accept or refuse."
          }
        }
      });
    }

    const normalizedInviteToken = normalizeInviteToken(inviteToken);
    if (!normalizedInviteToken) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            token: "token is required."
          }
        }
      });
    }

    const inviteTokenHash = resolveInviteTokenHash(normalizedInviteToken);
    if (!inviteTokenHash) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            token: "token is invalid."
          }
        }
      });
    }

    return runInInviteTransaction(async (trx) => {
      const options = trx ? { trx } : {};
      const invite = await consoleInvitesRepository.findPendingByTokenHash(inviteTokenHash, options);
      if (!invite) {
        throw new AppError(404, "Invite not found.");
      }
      if (normalizeEmail(invite.email) !== email) {
        throw new AppError(403, "Forbidden.");
      }

      if (normalizedDecision === "refuse") {
        await consoleInvitesRepository.revokeById(invite.id, options);
        return {
          ok: true,
          decision: "refused",
          inviteId: Number(invite.id)
        };
      }

      const roleId = normalizeRoleForAssignment(invite.roleId || roleCatalog.defaultInviteRole);
      await consoleMembershipsRepository.ensureActiveByUserId(userId, roleId, options);
      await consoleInvitesRepository.markAcceptedById(invite.id, options);

      return {
        ok: true,
        decision: "accepted",
        inviteId: Number(invite.id),
        membership: {
          roleId,
          status: "active"
        }
      };
    });
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

  async function listBillingEvents(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.READ_ALL);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingRepository || typeof billingRepository.listBillingActivityEvents !== "function") {
      throw new AppError(501, "Console billing event explorer is not available.");
    }

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 25,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const workspaceId = parsePositiveInteger(query?.workspaceId);
    const ownerUserId = parsePositiveInteger(query?.userId);
    const billableEntityId = parsePositiveInteger(query?.billableEntityId);
    const operationKey = normalizeOptionalString(query?.operationKey);
    const providerEventId = normalizeOptionalString(query?.providerEventId);
    const source = normalizeOptionalString(query?.source).toLowerCase();

    const events = await billingRepository.listBillingActivityEvents({
      workspaceId: workspaceId || null,
      ownerUserId: ownerUserId || null,
      billableEntityId: billableEntityId || null,
      operationKey: operationKey || null,
      providerEventId: providerEventId || null,
      source: source || null,
      includeGlobal: true,
      limit: fetchLimit
    });

    const hasMore = events.length > startIndex + pagination.pageSize;
    const entries = events.slice(startIndex, startIndex + pagination.pageSize);

    return {
      entries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function listBillingPlans(user) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);
    return buildConsoleBillingPlanCatalog({
      billingRepository,
      activeBillingProvider
    });
  }

  async function createBillingPlan(user, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);
    const normalized = normalizeBillingCatalogPlanCreatePayload(payload, {
      activeBillingProvider
    });
    const resolvedBasePrice = await resolveCatalogBasePriceForCreate({
      activeBillingProvider,
      billingProviderAdapter,
      basePrice: normalized.basePrice
    });

    try {
      const createdPlan = await billingRepository.transaction(async (trx) => {
        const plan = await billingRepository.createPlan(normalized.plan, { trx });
        await billingRepository.createPlanPrice(
          {
            ...resolvedBasePrice,
            planId: plan.id
          },
          { trx }
        );

        for (const entitlement of normalized.entitlements) {
          await billingRepository.upsertPlanEntitlement(
            {
              planId: plan.id,
              code: entitlement.code,
              schemaVersion: entitlement.schemaVersion,
              valueJson: entitlement.valueJson
            },
            { trx }
          );
        }

        const prices = await billingRepository.listPlanPricesForPlan(plan.id, activeBillingProvider, { trx });
        const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id, { trx });
        return {
          ...plan,
          prices,
          entitlements
        };
      });

      return {
        provider: activeBillingProvider,
        plan: createdPlan
      };
    } catch (error) {
      const mappedError = mapBillingPlanDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
  }

  async function listBillingProviderPrices(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.listPrices !== "function") {
      throw new AppError(501, "Provider price listing is not available.");
    }

    const limit = Math.max(1, Math.min(100, parsePositiveInteger(query?.limit) || 100));
    const normalizedActive = String(query?.active ?? "")
      .trim()
      .toLowerCase();
    const active = normalizedActive === "false" || normalizedActive === "0" ? false : true;
    const prices = await billingProviderAdapter.listPrices({
      limit,
      active
    });

    return {
      provider: activeBillingProvider,
      prices: Array.isArray(prices) ? prices : []
    };
  }

  async function updateBillingPlanPrice(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);
    if (typeof billingRepository.updatePlanPriceById !== "function") {
      throw new AppError(501, "Console billing catalog is not available.");
    }

    const planId = parsePositiveInteger(params?.planId);
    const priceId = parsePositiveInteger(params?.priceId);
    if (!planId || !priceId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            planId: "planId is required.",
            priceId: "priceId is required."
          }
        }
      });
    }

    const normalizedPatch = normalizeBillingCatalogPlanPricePatchPayload(payload, {
      activeBillingProvider
    });
    const resolvedPatch = await resolveCatalogPricePatchForUpdate({
      activeBillingProvider,
      billingProviderAdapter,
      patch: normalizedPatch
    });

    try {
      const updatedPlan = await billingRepository.transaction(async (trx) => {
        const plan = await billingRepository.findPlanById(planId, { trx });
        if (!plan) {
          throw new AppError(404, "Billing plan not found.");
        }

        const prices = await billingRepository.listPlanPricesForPlan(plan.id, activeBillingProvider, { trx });
        const targetPrice = prices.find((entry) => Number(entry?.id) === priceId);
        if (!targetPrice) {
          throw new AppError(404, "Billing plan price not found.");
        }

        await billingRepository.updatePlanPriceById(
          priceId,
          {
            providerPriceId: resolvedPatch.providerPriceId,
            providerProductId: resolvedPatch.providerProductId,
            currency: resolvedPatch.currency,
            unitAmountMinor: resolvedPatch.unitAmountMinor,
            interval: resolvedPatch.interval,
            intervalCount: resolvedPatch.intervalCount,
            usageType: resolvedPatch.usageType
          },
          { trx }
        );

        const nextPrices = await billingRepository.listPlanPricesForPlan(plan.id, activeBillingProvider, { trx });
        const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id, { trx });
        return {
          ...plan,
          prices: nextPrices,
          entitlements
        };
      });

      return {
        provider: activeBillingProvider,
        plan: updatedPlan
      };
    } catch (error) {
      const mappedError = mapBillingPlanDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
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
    listBillingEvents,
    listBillingPlans,
    createBillingPlan,
    listBillingProviderPrices,
    updateBillingPlanPrice
  };
}

export { createService };
