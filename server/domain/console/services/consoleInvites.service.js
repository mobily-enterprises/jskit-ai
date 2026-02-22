import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
import { mapInvite, mapPendingInvite } from "../mappers/consoleMappers.js";
import { resolveInviteExpiresAt } from "../policies/invitePolicy.js";
import {
  buildInviteToken,
  encodeInviteTokenHash,
  hashInviteToken,
  normalizeInviteToken,
  resolveInviteTokenHash
} from "../policies/inviteTokens.js";
import { CONSOLE_MANAGEMENT_PERMISSIONS } from "../policies/roles.js";

function createConsoleInvitesService({
  requirePermission,
  runInInviteTransaction,
  consoleInvitesRepository,
  consoleMembershipsRepository,
  userProfilesRepository,
  roleCatalog,
  normalizeRoleForAssignment
} = {}) {
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

  return {
    listPendingInvitesForUser,
    listInvites,
    createInvite,
    revokeInvite,
    respondToPendingInviteByToken
  };
}

export { createConsoleInvitesService };

