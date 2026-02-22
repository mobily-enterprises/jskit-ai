import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { mapMembershipSummary } from "../mappers/consoleMappers.js";
import {
  CONSOLE_ROLE_ID,
  hasPermission,
  normalizeRoleId,
  resolveRolePermissions
} from "../policies/roles.js";

function createConsoleAccessService({
  consoleMembershipsRepository,
  consoleRootRepository,
  listPendingInvitesForUser = async () => []
} = {}) {
  if (!consoleMembershipsRepository || !consoleRootRepository) {
    throw new Error("consoleMembershipsRepository and consoleRootRepository are required.");
  }

  async function runInTransaction(work) {
    if (typeof consoleMembershipsRepository.transaction === "function") {
      return consoleMembershipsRepository.transaction(work);
    }

    return work(null);
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

  return {
    ensureRootMutationAllowed,
    ensureInitialConsoleMember,
    resolveRequestContext,
    requireConsoleAccess,
    requirePermission
  };
}

export { createConsoleAccessService };
