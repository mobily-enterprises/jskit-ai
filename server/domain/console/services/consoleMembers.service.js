import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { mapMember } from "../mappers/consoleMappers.js";
import { CONSOLE_MANAGEMENT_PERMISSIONS, CONSOLE_ROLE_ID, normalizeRoleId } from "../policies/roles.js";

function createConsoleMembersService({
  requirePermission,
  consoleMembershipsRepository,
  roleCatalog,
  normalizeRoleForAssignment,
  ensureRootMutationAllowed
} = {}) {
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

  return {
    listMembers,
    updateMemberRole
  };
}

export { createConsoleMembersService };

