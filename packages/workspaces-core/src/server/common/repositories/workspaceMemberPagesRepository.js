import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeMemberSummaryRow } from "./workspaceMembershipsRepository.js";

// A page's cursor: its last member's display name and user id, the list's order, as base64url JSON.
function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.display_name, String(row.user_id)])).toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const [displayName, userId] = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (typeof displayName === "string" && typeof userId === "string") {
      return { displayName, userId };
    }
  } catch {
    // Not a cursor this list answered: refused below.
  }
  throw new AppError(400, "This list's cursor is not one it answered.", { code: "workspaces.member.cursorInvalid" });
}

/**
 * A workspace's members a page at a time, with their users' names and emails: the members list of
 * `workspaces.core`. A page is one statement on the memberships joined to users.profiles' join source, so it reads
 * a page of rows however many members the workspace has.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaceMemberships
 *   The workspace_memberships table's handle.
 * @param {Pick<import("@jskit-ai/users-core/server/types").UsersProfiles, "joinSource">} dependencies.userProfiles
 */
function createRepository({ workspaceMemberships, userProfiles }) {
  /**
   * One page of the workspace's active members by display name (then user id), each as listActiveByWorkspaceId
   * summarizes it: `{ members, next }`, where `next` is the cursor of the page after, or null on the last page.
   * @param {unknown} workspaceId
   * @param {{ size: number, after?: string }} page At most the memberships handle's pageLimits().request members.
   * @param {object} [options]
   */
  // Knex: report - one page of a workspace's active members with their users' names and emails, by display name
  async function listActivePage(workspaceId, { size, after }, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return { members: [], next: null };
    }

    const limit = Math.min(Number(size), workspaceMemberships.pageLimits().request);
    const user = await userProfiles.joinSource({ alias: "u" }, options);
    const profiles = user.query
      .select({ userId: user.column("id"), shown: user.column("displayName"), mail: user.column("email") })
      .as("p");
    const { query } = await workspaceMemberships.scopedQuery(
      { alias: "m", filters: { workspace: normalizedWorkspaceId, status: "active" } },
      options
    );
    const memberUserId = workspaceMemberships.column("userId", "m");
    query
      .join(profiles, "p.userId", memberUserId)
      .select({
        user_id: memberUserId,
        role_sid: workspaceMemberships.column("roleSid", "m"),
        status: workspaceMemberships.column("status", "m"),
        display_name: "p.shown",
        email: "p.mail"
      })
      .orderBy(["p.shown", memberUserId])
      .limit(limit + 1);
    if (after !== undefined) {
      const last = decodeCursor(after);
      query.where((later) => later.where("p.shown", ">", last.displayName)
        .orWhere((tie) => tie.where("p.shown", last.displayName).where(memberUserId, ">", last.userId)));
    }
    const rows = await query;
    return {
      members: rows.slice(0, limit).map(normalizeMemberSummaryRow),
      next: rows.length > limit ? encodeCursor(rows[limit - 1]) : null
    };
  }

  return Object.freeze({
    listActivePage
  });
}

export { createRepository };
