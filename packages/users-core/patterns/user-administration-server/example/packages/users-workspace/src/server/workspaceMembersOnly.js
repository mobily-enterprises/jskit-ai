import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { passedOn, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";

// The page size json-rest-api reads for a list that names none.
const DEFAULT_PAGE_SIZE = 20;

// A page's cursor: the display name, email and id of its last user, the users list's order, as base64url JSON.
function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.displayName, row.email, String(row.id)])).toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const [displayName, email, id] = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if ([displayName, email, id].every((value) => typeof value === "string")) {
      return { displayName, email, id };
    }
  } catch {
    // Not a cursor this list answered: refused below.
  }
  throw new AppError(400, "This list's cursor is not one it answered.", { code: "users.list.cursorInvalid" });
}

/**
 * users-core's users repository narrowed to the caller's workspace: a list reads only the workspace's active members,
 * and anyone else is a missing record, so a workspace admin never learns who else has an account. The users table is
 * public, so its handle alone would list every user. A page is one report over the users the list's filters match
 * that hold an active membership in the workspace, in the users list's order, so it reads a page of rows however many
 * members the workspace has; the users repository then reads that page's users as the CRUD contract answers them. It
 * answers only the reads it narrows (query and get, with pageLimits): the rest of users.profiles, such as findByEmail
 * or countUsers, never passes through this feature's repository, so nothing reaches users past the narrowing through it.
 * @param {import("@jskit-ai/crud-core/server/types").CrudRepository & Pick<import("@jskit-ai/users-core/server/types").UsersProfiles, "joinSource">} repository
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesMemberships} memberships
 */
function workspaceMembersOnly(repository, memberships) {
  // Knex: report - one page of the users the list's filters match that are active members of the workspace, in the users list's order
  async function memberPage(workspaceId, filters, { size, after }, options) {
    const user = await repository.joinSource({ alias: "u", ...(filters === undefined ? {} : { filters }) }, options);
    const member = await memberships.joinSource({ alias: "m", filters: { workspace: workspaceId, status: "active" } }, options);
    const [shown, mail, key] = [user.column("displayName"), user.column("email"), user.column("id")];
    const query = user.query
      .whereExists(member.query.select(member.column("id")).whereColumn(member.column("userId"), key))
      .select({ id: key, displayName: shown, email: mail })
      .orderBy([shown, mail, key])
      .limit(size + 1);
    if (after !== undefined) {
      const last = decodeCursor(after);
      query.where((later) => later.where(shown, ">", last.displayName)
        .orWhere((tie) => tie.where(shown, last.displayName).where(mail, ">", last.email))
        .orWhere((tie) => tie.where(shown, last.displayName).where(mail, last.email).where(key, ">", last.id)));
    }
    const rows = await query;
    return { ids: rows.slice(0, size).map((row) => String(row.id)), next: rows.length > size ? encodeCursor(rows[size - 1]) : null };
  }

  /**
   * One page of the workspace's members the params select: the report picks the page's users, the users repository
   * reads them, and the page's cursor is the report's.
   * @param {Record<string, any>} params
   * @param {{ context?: object }} options
   */
  async function query(params, options) {
    const workspaceId = resolveWorkspaceScopeValue(options.context);
    const size = Number(params.page?.size ?? DEFAULT_PAGE_SIZE);
    const after = params.page?.after;
    // A context with no workspace has no members: the page is empty.
    const page = workspaceId
      ? await memberPage(workspaceId, params.filters, { size: Math.min(size, repository.pageLimits().request), after }, passedOn(options))
      : { ids: [], next: null };
    // An empty list matches no row. A size over the page limit throws here, as the users list's own read does.
    const result = await repository.query({ ...params, filters: { id: page.ids }, page: { size } }, options);
    const hasMore = page.next !== null;
    if (options.format !== "jsonapi") {
      return { records: result.records, page: { size, hasMore, next: page.next } };
    }
    // The users read's own links would name its id list; the page's cursor is the report's.
    const { links: _links, ...document } = result;
    return {
      ...document,
      meta: { ...document.meta, pagination: { pageSize: size, hasMore, ...(hasMore ? { cursor: { next: page.next } } : {}) } }
    };
  }

  /**
   * A member of the workspace, or a missing record for anyone else. It reads the one membership.
   * @param {unknown} id
   * @param {Record<string, any>} params
   * @param {{ context?: object, missing?: "skip" }} options
   */
  async function get(id, params, options) {
    const membership = await memberships.findByWorkspaceIdAndUserId(resolveWorkspaceScopeValue(options.context), id, passedOn(options));
    if (membership?.status === "active") {
      return repository.get(id, params, options);
    }
    if (options.missing === "skip") {
      return null;
    }
    throw new AppError(404, "Document not found.", { code: "crud.document.notFound" });
  }

  return Object.freeze({ query, get, pageLimits: repository.pageLimits });
}

export { workspaceMembersOnly };
