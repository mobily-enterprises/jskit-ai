import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";

/**
 * users-core's users repository narrowed to the caller's workspace: a list reads only the workspace's active members,
 * and anyone else is a missing record, so a workspace admin never learns who else has an account. The users table is
 * public, so its handle alone would list every user; the narrowing reads the workspace's memberships first.
 * @param {import("@jskit-ai/crud-core/server/types").CrudRepository} repository
 * @param {import("@jskit-ai/workspaces-core/server/types").WorkspaceMembershipsRepository} memberships
 */
function workspaceMembersOnly(repository, memberships) {
  // The caller's workspace's active members; none when the context names no workspace.
  function memberIds(options) {
    return memberships.activeMemberIds(resolveWorkspaceScopeValue(options.context), options);
  }

  /**
   * One page of the workspace's members the params select.
   * @param {Record<string, any>} params
   * @param {{ context?: object }} options
   */
  async function query(params, options) {
    const members = await memberIds(options);
    const requested = params.filters?.ids;
    // An empty list matches no row: a workspace with no members lists nobody.
    const ids = requested === undefined ? members : [requested].flat().map(String).filter((id) => members.includes(id));
    return repository.query({ ...params, filters: { ...params.filters, ids } }, options);
  }

  /**
   * A member of the workspace, or a missing record for anyone else.
   * @param {unknown} id
   * @param {Record<string, any>} params
   * @param {{ context?: object, missing?: "skip" }} options
   */
  async function get(id, params, options) {
    if ((await memberIds(options)).includes(String(id))) {
      return repository.get(id, params, options);
    }
    if (options.missing === "skip") {
      return null;
    }
    throw new AppError(404, "Document not found.", { code: "crud.document.notFound" });
  }

  return Object.freeze({ ...repository, query, get });
}

export { workspaceMembersOnly };
