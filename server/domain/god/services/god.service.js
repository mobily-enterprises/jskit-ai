import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
import { mapInvite, mapMember, mapMembershipSummary, mapPendingInvite } from "../mappers/godMappers.js";
import { resolveInviteExpiresAt } from "../policies/invitePolicy.js";
import {
  buildInviteToken,
  encodeInviteTokenHash,
  hashInviteToken,
  normalizeInviteToken,
  resolveInviteTokenHash
} from "../policies/inviteTokens.js";
import {
  GOD_MANAGEMENT_PERMISSIONS,
  GOD_ROLE_ID,
  getRoleCatalog,
  hasPermission,
  normalizeRoleId,
  resolveAssignableRoleIds,
  resolveRolePermissions
} from "../policies/roles.js";

function createService({ godMembershipsRepository, godInvitesRepository, userProfilesRepository }) {
  if (!godMembershipsRepository || !godInvitesRepository || !userProfilesRepository) {
    throw new Error("god service repositories are required.");
  }

  const roleCatalog = getRoleCatalog();
  const assignableRoleIds = resolveAssignableRoleIds();

  async function runInTransaction(work) {
    if (typeof godMembershipsRepository.transaction === "function") {
      return godMembershipsRepository.transaction(work);
    }

    return work(null);
  }

  async function runInInviteTransaction(work) {
    if (typeof godInvitesRepository.transaction === "function") {
      return godInvitesRepository.transaction(work);
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

  async function ensureInitialGodMember(userId) {
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return null;
    }

    return runInTransaction(async (trx) => {
      const transactionOptions = trx ? { trx } : {};
      const existingMembership = await godMembershipsRepository.findByUserId(numericUserId, transactionOptions);
      if (existingMembership) {
        return existingMembership;
      }

      const activeCount = await godMembershipsRepository.countActiveMembers(transactionOptions);
      if (activeCount > 0) {
        return null;
      }

      try {
        return await godMembershipsRepository.insert(
          {
            userId: numericUserId,
            roleId: GOD_ROLE_ID,
            status: "active"
          },
          transactionOptions
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }
      }

      return godMembershipsRepository.findByUserId(numericUserId, transactionOptions);
    });
  }

  async function listPendingInvitesForUser(user) {
    const email = normalizeEmail(user?.email);
    if (!email) {
      return [];
    }

    const userId = parsePositiveInteger(user?.id);
    const membership = userId ? await godMembershipsRepository.findByUserId(userId) : null;
    if (membership && membership.status === "active") {
      return [];
    }

    const invites = await godInvitesRepository.listPendingByEmail(email);
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

    await ensureInitialGodMember(userId);

    const membership = await godMembershipsRepository.findByUserId(userId);
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

  async function requireGodAccess(user) {
    const context = await resolveRequestContext({ user });
    if (!context.hasAccess) {
      throw new AppError(403, "Forbidden.");
    }

    return context;
  }

  async function requirePermission(user, permission) {
    const context = await requireGodAccess(user);
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
        isGod: false
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
      isGod: context.hasAccess
    };
  }

  async function listMembers(user) {
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW);
    const members = await godMembershipsRepository.listActive();

    return {
      members: members.map(mapMember).filter(Boolean),
      roleCatalog
    };
  }

  async function updateMemberRole(user, payload) {
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.MEMBERS_MANAGE);

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
    const existingMembership = await godMembershipsRepository.findByUserId(memberUserId);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }

    if (normalizeRoleId(existingMembership.roleId) === GOD_ROLE_ID) {
      throw new AppError(409, "Cannot change the god super-user role.");
    }

    await godMembershipsRepository.updateRoleByUserId(memberUserId, roleId);
    return listMembers(user);
  }

  async function listInvites(user) {
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.MEMBERS_VIEW);
    const invites = await godInvitesRepository.listPending();

    return {
      invites: invites.map(mapInvite).filter(Boolean),
      roleCatalog
    };
  }

  async function createInvite(user, payload) {
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.MEMBERS_INVITE);

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
      const existingMembership = await godMembershipsRepository.findByUserId(existingUser.id);
      if (existingMembership && existingMembership.status === "active") {
        throw new AppError(409, "User is already a god member.");
      }
    }

    const inviteToken = buildInviteToken();
    let createdInvite = null;

    await runInInviteTransaction(async (trx) => {
      const options = trx ? { trx } : {};
      await godInvitesRepository.expirePendingByEmail(email, options);

      try {
        createdInvite = await godInvitesRepository.insert(
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
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.INVITES_REVOKE);

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

    const invite = await godInvitesRepository.findPendingById(numericInviteId);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await godInvitesRepository.revokeById(numericInviteId);
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
      const invite = await godInvitesRepository.findPendingByTokenHash(inviteTokenHash, options);
      if (!invite) {
        throw new AppError(404, "Invite not found.");
      }
      if (normalizeEmail(invite.email) !== email) {
        throw new AppError(403, "Forbidden.");
      }

      if (normalizedDecision === "refuse") {
        await godInvitesRepository.revokeById(invite.id, options);
        return {
          ok: true,
          decision: "refused",
          inviteId: Number(invite.id)
        };
      }

      const roleId = normalizeRoleForAssignment(invite.roleId || roleCatalog.defaultInviteRole);
      await godMembershipsRepository.ensureActiveByUserId(userId, roleId, options);
      await godInvitesRepository.markAcceptedById(invite.id, options);

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
    await requirePermission(user, GOD_MANAGEMENT_PERMISSIONS.ROLES_VIEW);
    return {
      roleCatalog
    };
  }

  return {
    ensureInitialGodMember,
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
