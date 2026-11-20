import { isLostDuplicateInsertRace, toIsoString } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { isSystemContext } from "@jskit-ai/resource-runtime/server";
import { ADMIN_ROLE_ID, OWNER_ROLE_ID } from "../../../shared/roles.js";
import { normalizeMembershipRecord } from "./workspaceMembershipsRepository.js";

function normalizeWorkspaceRecord(payload = null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    id: normalizeRecordId(payload.id, { fallback: null }),
    slug: normalizeText(payload.slug),
    name: normalizeText(payload.name),
    ownerUserId: normalizeRecordId(payload.ownerUserId || payload?.owner?.id, { fallback: null }),
    isPersonal: payload.isPersonal === true,
    avatarUrl: normalizeText(payload.avatarUrl),
    createdAt: payload.createdAt ? toIsoString(payload.createdAt) : null,
    updatedAt: payload.updatedAt ? toIsoString(payload.updatedAt) : null,
    deletedAt: payload.deletedAt ? toIsoString(payload.deletedAt) : null
  };
}

// Lower ids first; ids that are not numbers in text order.
function byId(left, right) {
  const leftId = Number(left?.id);
  const rightId = Number(right?.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return leftId - rightId;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

/**
 * The `workspaces` capability: the workspaces table's records. Every method
 * takes the caller's options last and joins their transaction.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaces The workspaces table's handle.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.workspaceMemberships
 *   The workspace_memberships table's handle, for a user's workspaces and the roles an ownership transfer changes.
 */
function createRepository({ workspaces, workspaceMemberships }) {
  async function queryFirst(filters, options) {
    const { records } = await workspaces.query({ filters, page: { size: 1 } }, options);
    return normalizeWorkspaceRecord(records[0] || null);
  }

  async function findById(workspaceId, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    return queryFirst({ id: normalizedWorkspaceId }, options);
  }

  // A deleted workspace keeps its slug, so the slug stays taken, but it is not found by it.
  async function findBySlug(slug, options = {}) {
    const normalizedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    if (!normalizedSlug) {
      return null;
    }

    return queryFirst({ slug: normalizedSlug, deletedAt: null }, options);
  }

  /**
   * Which of these slugs workspaces already hold, in one read however many do.
   * @param {string[]} slugs
   * @param {object} [options]
   * @returns {Promise<Set<string>>}
   */
  async function listSlugsIn(slugs, options = {}) {
    const normalizedSlugs = [...new Set(
      (Array.isArray(slugs) ? slugs : []).map((slug) => normalizeLowerText(slug)).filter(Boolean)
    )];
    if (normalizedSlugs.length < 1) {
      return new Set();
    }

    const rows = await workspaces.queryAll({ filters: { slugs: normalizedSlugs } }, options);
    return new Set(rows.map((row) => normalizeLowerText(row.slug)));
  }

  /**
   * The workspaces with these ids, in one read however many, sorted by id. An id naming no workspace is left out; a
   * deleted workspace is kept, as findById keeps it.
   * @param {unknown[]} workspaceIds
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   */
  async function listByIds(workspaceIds, options = {}) {
    if (!Array.isArray(workspaceIds)) {
      throw new TypeError("workspaces.listByIds() takes a list of workspace ids.");
    }
    const ids = [...new Set(workspaceIds.map((id) => normalizeRecordId(id, { fallback: null })).filter(Boolean))];
    if (ids.length < 1) {
      return [];
    }
    const rows = await workspaces.queryAll({ filters: { id: ids } }, options);
    return rows.map((row) => normalizeWorkspaceRecord(row)).filter(Boolean).sort(byId);
  }

  /**
   * One page of the workspaces that are not deleted, for background work across all of them: in id order, those after
   * `afterId` (from the first when it is null or left out), at most `limit`, each as `{ id, slug }`. Work over every
   * workspace passes the last id of each page as the next page's `afterId`; a page shorter than `limit` is the last.
   * Each page is one statement, however many workspaces there are. Only a system context calls it (`{ context:
   * systemContext(reason) }`): any other context, one that forWorkspace or its kin derived too, is refused before any
   * statement, as are an `afterId` that is no workspace id and a `limit` that is not a whole number from 1 to the
   * workspaces' page limit (pageLimits().request, 100 unless the application sets another).
   * @param {{ afterId?: unknown, limit: number }} page
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @returns {Promise<Array<{ id: string, slug: string }>>}
   */
  async function listForSystem({ afterId = null, limit } = {}, options = {}) {
    if (!isSystemContext(options.context)) {
      throw new TypeError("workspaces.listForSystem() runs only in a system context: pass { context: systemContext(reason) }.");
    }
    const pageLimit = workspaces.pageLimits().request;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > pageLimit) {
      throw new TypeError(`workspaces.listForSystem() limit is a whole number from 1 to ${pageLimit}. Received: ${String(limit)}`);
    }
    const after = normalizeRecordId(afterId, { fallback: null });
    if (afterId !== null && !after) {
      throw new TypeError(
        "workspaces.listForSystem() afterId is the id of the last workspace of the page before, or null for the first page. " +
          `Received: ${String(afterId)}`
      );
    }
    const { records } = await workspaces.query({
      filters: after ? { deletedAt: null, idAfter: after } : { deletedAt: null },
      sort: ["id"],
      fields: ["slug"],
      page: { size: limit }
    }, options);
    return records.map((record) => ({ id: normalizeRecordId(record.id, { fallback: null }), slug: normalizeText(record.slug) }));
  }

  async function findPersonalByOwnerUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return null;
    }

    const rows = await workspaces.queryAll({ filters: { owner: normalizedUserId, isPersonal: true } }, options);
    const normalizedRows = rows.map((row) => normalizeWorkspaceRecord(row)).filter(Boolean);
    normalizedRows.sort(byId);
    return normalizedRows[0] || null;
  }

  async function insert(payload, options = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const ownerUserId = normalizeRecordId(source.ownerUserId, { fallback: null });
    if (!ownerUserId) {
      throw new TypeError("workspacesRepository.insert requires ownerUserId.");
    }

    const createPayload = {
      ...(Object.hasOwn(source, "slug") ? { slug: source.slug } : {}),
      ...(Object.hasOwn(source, "name") ? { name: source.name } : {}),
      ...(Object.hasOwn(source, "isPersonal") ? { isPersonal: source.isPersonal } : {}),
      ...(Object.hasOwn(source, "avatarUrl") ? { avatarUrl: source.avatarUrl } : {})
    };

    try {
      const createdAt = new Date().toISOString();
      const created = await workspaces.create(
        {
          ...createPayload,
          createdAt,
          updatedAt: createdAt,
          ownerUserId
        },
        options
      );

      return normalizeWorkspaceRecord(created);
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
      if (!Object.hasOwn(createPayload, "slug")) {
        throw error;
      }

      // A create lost to the same owner's identical create, such as a personal workspace made twice at a first
      // sign-in, answers that workspace. Another owner's workspace is never answered: the caller picks another slug.
      const bySlug = await findBySlug(createPayload.slug, options);
      if (bySlug && bySlug.ownerUserId === ownerUserId && bySlug.isPersonal === (createPayload.isPersonal === true)) {
        return bySlug;
      }
      throw error;
    }
  }

  async function updateById(workspaceId, patch, options = {}) {
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const sourcePatch = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const workspacePatch = {
      ...sourcePatch,
      updatedAt: new Date().toISOString()
    };
    if (Object.hasOwn(sourcePatch, "ownerUserId")) {
      workspacePatch.ownerUserId = normalizeRecordId(sourcePatch.ownerUserId, { fallback: null });
    }

    return normalizeWorkspaceRecord(await workspaces.patch(normalizedWorkspaceId, workspacePatch, options));
  }

  async function listForUserId(userId, options = {}) {
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    const rows = await workspaceMemberships.queryAll(
      { filters: { user: normalizedUserId, status: "active" }, include: ["workspace"] },
      options
    );

    const userWorkspaces = rows
      .map((row) => {
        const workspace = normalizeWorkspaceRecord(row?.workspace);
        if (!workspace || workspace.deletedAt != null) {
          return null;
        }

        return {
          ...workspace,
          roleSid: row?.roleSid,
          membershipStatus: row?.status
        };
      })
      .filter(Boolean);

    userWorkspaces.sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) {
        return left.isPersonal ? -1 : 1;
      }
      return byId(left, right);
    });

    return userWorkspaces;
  }

  /**
   * Locks a workspace's row until the caller's transaction ends, so work that
   * must not interleave for one workspace takes turns. It needs an active
   * transaction: pass the txOptions of withTransaction. A missing workspace
   * throws json-rest-api's not-found error, or answers null with
   * `missing: "skip"`.
   * @param {unknown} workspaceId
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions & { missing?: "throw" | "skip" }} options
   * @returns {Promise<{ id: string } | null>} The locked workspace.
   */
  async function lock(workspaceId, options = {}) {
    const id = normalizeRecordId(workspaceId, { fallback: null });
    if (!id) {
      throw new TypeError("Locking a workspace requires workspaceId.");
    }
    const row = await workspaces.lock(id, options);
    return row ? { id: normalizeRecordId(row.id, { fallback: null }) } : null;
  }

  /**
   * Deletes the workspace's row, in the caller's transaction when `options` carries one. The database's cascades take
   * its memberships, settings and invites with it; a table of the application's own that references the workspace
   * without a cascade refuses the delete. Answers false when there was no such workspace, true otherwise. It
   * publishes no event: an application keeping its own copy of workspace facts updates it from the answer.
   * @param {unknown} workspaceId
   * @param {object} [options]
   * @returns {Promise<boolean>}
   */
  async function deleteById(workspaceId, options = {}) {
    const id = normalizeRecordId(workspaceId, { fallback: null });
    if (!id) {
      throw new TypeError(`workspaces.deleteById() requires a workspace id. Received: ${String(workspaceId)}`);
    }
    return (await workspaces.delete(id, { ...options, missing: "skip" })) !== null;
  }

  /**
   * Hands a workspace to another of its active members, in the caller's transaction when `options` carries one (the
   * txOptions of withTransaction), otherwise in one of its own. It locks the workspace's row first and reads the
   * workspace through that lock, then locks the new and the previous owner's memberships, so two transfers of one
   * workspace take turns and the second moves it on from the owner the first left. `owner_user_id` becomes `toUserId`
   * and `updatedAt` moves; the new owner's membership takes the owner role; the previous owner's takes
   * `previousOwnerRoleSid` (the admin role unless given) and stays active, or is created active with it when they had
   * none. It sends the same statements however many members the workspace has.
   *
   * A personal workspace stops being personal: it was the one provisioned for its previous owner, and the new owner's
   * own personal workspace stays theirs. Where the application provisions personal workspaces, the previous owner is
   * given a new one at their next provisioning.
   *
   * A `toUserId` who already owns the workspace writes nothing and answers `changed: false`. A missing or deleted
   * workspace is 404 `workspaces.workspace.notFound`, and a `toUserId` with no active membership (never a member,
   * invited only, removed) is 409 `workspaces.member.newOwnerNotActive`; neither writes anything. Ids that are no
   * record ids, and a `previousOwnerRoleSid` that is not the text of a role other than the owner's, are a TypeError
   * before any statement. The role is stored lowercased as given: the role catalog is not checked here.
   *
   * It publishes no event: the `workspace.workspaces.create` and `workspace.workspaces.update` actions publish
   * `entity.changed` on `runtime.events`, and this is no action. An application that keeps its own copy of workspace
   * facts updates it from the answer.
   * @param {{ workspaceId: unknown, toUserId: unknown, previousOwnerRoleSid?: string }} transfer
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} [options]
   * @returns {Promise<{ id: string, slug: string, name: string, ownerUserId: string, isPersonal: boolean, avatarUrl: string,
   *   createdAt: string | null, updatedAt: string | null, deletedAt: string | null, previousOwnerUserId: string, changed: boolean }>}
   *   The workspace as findById answers it, the owner it had before the call, and whether the call changed it.
   */
  async function transferOwnership({ workspaceId, toUserId, previousOwnerRoleSid = ADMIN_ROLE_ID }, options = {}) {
    const id = normalizeRecordId(workspaceId, { fallback: null });
    const newOwnerUserId = normalizeRecordId(toUserId, { fallback: null });
    if (!id || !newOwnerUserId) {
      throw new TypeError(
        "workspaces.transferOwnership() requires workspaceId and toUserId, each a record id. " +
          `Received: ${String(workspaceId)} and ${String(toUserId)}`
      );
    }
    const previousOwnerRole = typeof previousOwnerRoleSid === "string" ? normalizeLowerText(previousOwnerRoleSid) : "";
    if (!previousOwnerRole || previousOwnerRole === OWNER_ROLE_ID) {
      throw new TypeError(
        `workspaces.transferOwnership() previousOwnerRoleSid is the previous owner's new role: a role id other than "${OWNER_ROLE_ID}". ` +
          `Received: ${String(previousOwnerRoleSid)}`
      );
    }

    return workspaces.withTransaction(options, async (txOptions) => {
      // A locking read sees the row as last committed, where a plain read inside a caller's transaction on MySQL and
      // MariaDB could see the snapshot of the caller's earlier read.
      const workspace = normalizeWorkspaceRecord(await workspaces.lock(id, { ...txOptions, missing: "skip" }));
      if (!workspace || workspace.deletedAt) {
        throw new AppError(404, "Workspace not found.", { code: "workspaces.workspace.notFound" });
      }
      const previousOwnerUserId = workspace.ownerUserId;
      if (previousOwnerUserId === newOwnerUserId) {
        return { ...workspace, previousOwnerUserId, changed: false };
      }

      const memberships = (await workspaceMemberships.lockWhere(
        { workspace: id, users: [newOwnerUserId, previousOwnerUserId] },
        txOptions
      )).map(normalizeMembershipRecord);
      const newOwner = memberships.find(({ userId }) => userId === newOwnerUserId);
      if (newOwner?.status !== "active") {
        throw new AppError(409, "The new owner must be an active member of the workspace.", {
          code: "workspaces.member.newOwnerNotActive"
        });
      }
      const previousOwner = memberships.find(({ userId }) => userId === previousOwnerUserId);

      const transferred = await updateById(id, { ownerUserId: newOwnerUserId, isPersonal: false }, txOptions);
      const changedAt = new Date().toISOString();
      const write = { ...txOptions, returning: "none" };
      await workspaceMemberships.patch(newOwner.id, { roleSid: OWNER_ROLE_ID, updatedAt: changedAt }, write);
      const previousOwnerMembership = { roleSid: previousOwnerRole, status: "active", updatedAt: changedAt };
      if (previousOwner) {
        await workspaceMemberships.patch(previousOwner.id, previousOwnerMembership, write);
      } else {
        await workspaceMemberships.create(
          { ...previousOwnerMembership, workspaceId: id, userId: previousOwnerUserId, createdAt: changedAt },
          write
        );
      }
      return { ...transferred, previousOwnerUserId, changed: true };
    });
  }

  return Object.freeze({
    withTransaction: workspaces.withTransaction,
    // The workspaces as a join source for another owner's report, which reads them in its own statement: the handle's
    // joinSource, the scoped workspaces under `alias` matching `filters` (a deleted workspace is in it unless the
    // report filters on `column("deletedAt")`).
    joinSource: workspaces.joinSource,
    findById,
    listByIds,
    listForSystem,
    findBySlug,
    listSlugsIn,
    findPersonalByOwnerUserId,
    insert,
    updateById,
    listForUserId,
    lock,
    deleteById,
    transferOwnership
  });
}

export { createRepository };
