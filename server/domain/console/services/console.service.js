import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
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
  CONSOLE_MANAGEMENT_PERMISSIONS,
  CONSOLE_ROLE_ID,
  getRoleCatalog,
  hasPermission,
  normalizeRoleId,
  resolveAssignableRoleIds,
  resolveRolePermissions
} from "../policies/roles.js";

function createService({ consoleMembershipsRepository, consoleInvitesRepository, userProfilesRepository }) {
  if (!consoleMembershipsRepository || !consoleInvitesRepository || !userProfilesRepository) {
    throw new Error("console service repositories are required.");
  }

  const roleCatalog = getRoleCatalog();
  const assignableRoleIds = resolveAssignableRoleIds();

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

  async function ensureInitialConsoleMember(userId) {
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return null;
    }

    return runInTransaction(async (trx) => {
      const transactionOptions = trx ? { trx } : {};
      const existingMembership = await consoleMembershipsRepository.findByUserId(numericUserId, transactionOptions);
      if (existingMembership) {
        return existingMembership;
      }

      const activeCount = await consoleMembershipsRepository.countActiveMembers(transactionOptions);
      if (activeCount > 0) {
        return null;
      }

      try {
        return await consoleMembershipsRepository.insert(
          {
            userId: numericUserId,
            roleId: CONSOLE_ROLE_ID,
            status: "active"
          },
          transactionOptions
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }
      }

      return consoleMembershipsRepository.findByUserId(numericUserId, transactionOptions);
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
    listRoles
  };
}

export { createService };
