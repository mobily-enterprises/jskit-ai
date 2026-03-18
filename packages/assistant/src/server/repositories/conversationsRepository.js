import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function parseJsonObject(value) {
  if (value == null) {
    return {};
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function mapConversationRow(row = {}) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    workspaceSlug: String(row.workspace_slug || ""),
    workspaceName: String(row.workspace_name || ""),
    title: String(row.title || "New conversation"),
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    createdByUserDisplayName: String(row.created_by_user_display_name || ""),
    createdByUserEmail: String(row.created_by_user_email || ""),
    status: String(row.status || "active"),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    surfaceId: String(row.surface_id || ""),
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    messageCount: Number(row.message_count || 0),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function normalizeCursorPagination(pagination = {}, { defaultLimit = 20, maxLimit = 200 } = {}) {
  const cursor = parsePositiveInteger(pagination.cursor) || 0;
  const limit = Math.max(1, Math.min(maxLimit, parsePositiveInteger(pagination.limit) || defaultLimit));

  return {
    cursor,
    limit
  };
}

function resolveInsertedId(insertResult) {
  if (Array.isArray(insertResult) && insertResult.length > 0) {
    const first = insertResult[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const objectId = Number(first.id);
      if (Number.isInteger(objectId) && objectId > 0) {
        return objectId;
      }
    }

    const scalarId = Number(first);
    if (Number.isInteger(scalarId) && scalarId > 0) {
      return scalarId;
    }
  }

  const directId = Number(insertResult);
  if (Number.isInteger(directId) && directId > 0) {
    return directId;
  }

  return 0;
}

function createConversationsRepository(knex) {
  if (!knex || typeof knex !== "function") {
    throw new Error("createConversationsRepository requires knex client.");
  }

  async function findById(conversationId, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as u", "u.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(u.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(u.email, '') AS created_by_user_email")
      )
      .where("c.id", numericConversationId)
      .first();

    return row ? mapConversationRow(row) : null;
  }

  async function findByIdForWorkspaceAndUser(conversationId, workspaceId, actorUserId, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    const numericActorUserId = parsePositiveInteger(actorUserId);
    if (!numericConversationId || !numericWorkspaceId || !numericActorUserId) {
      return null;
    }

    const client = options?.trx || knex;
    const row = await client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as u", "u.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(u.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(u.email, '') AS created_by_user_email")
      )
      .where("c.id", numericConversationId)
      .where("c.workspace_id", numericWorkspaceId)
      .where("c.created_by_user_id", numericActorUserId)
      .first();

    return row ? mapConversationRow(row) : null;
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const now = new Date();
    const insertResult = await client("ai_conversations").insert({
      workspace_id: parsePositiveInteger(payload.workspaceId),
      created_by_user_id: parsePositiveInteger(payload.createdByUserId) || null,
      title: normalizeText(payload.title) || "New conversation",
      status: normalizeText(payload.status).toLowerCase() || "active",
      provider: normalizeText(payload.provider),
      model: normalizeText(payload.model),
      surface_id: normalizeText(payload.surfaceId).toLowerCase() || "admin",
      message_count: parsePositiveInteger(payload.messageCount) || 0,
      metadata_json: stringifyJsonObject(payload.metadata),
      started_at: payload.startedAt ? new Date(payload.startedAt) : now,
      ended_at: payload.endedAt ? new Date(payload.endedAt) : null,
      created_at: now,
      updated_at: now
    });
    const id = resolveInsertedId(insertResult);
    if (!id) {
      throw new Error("conversationsRepository.create could not resolve inserted id.");
    }

    return findById(id, {
      trx: client
    });
  }

  async function updateById(conversationId, patch = {}, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const updatePatch = {};

    if (Object.hasOwn(patch, "title")) {
      updatePatch.title = normalizeText(patch.title) || "New conversation";
    }
    if (Object.hasOwn(patch, "status")) {
      updatePatch.status = normalizeText(patch.status).toLowerCase() || "active";
    }
    if (Object.hasOwn(patch, "provider")) {
      updatePatch.provider = normalizeText(patch.provider);
    }
    if (Object.hasOwn(patch, "model")) {
      updatePatch.model = normalizeText(patch.model);
    }
    if (Object.hasOwn(patch, "surfaceId")) {
      updatePatch.surface_id = normalizeText(patch.surfaceId).toLowerCase() || "admin";
    }
    if (Object.hasOwn(patch, "messageCount")) {
      updatePatch.message_count = Math.max(0, Number(patch.messageCount || 0));
    }
    if (Object.hasOwn(patch, "endedAt")) {
      updatePatch.ended_at = patch.endedAt ? new Date(patch.endedAt) : null;
    }
    if (Object.hasOwn(patch, "metadata")) {
      updatePatch.metadata_json = stringifyJsonObject(patch.metadata);
    }

    if (Object.keys(updatePatch).length > 0) {
      updatePatch.updated_at = new Date();
      await client("ai_conversations").where({ id: numericConversationId }).update(updatePatch);
    }

    return findById(numericConversationId, {
      trx: client
    });
  }

  async function incrementMessageCount(conversationId, delta = 1, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      return null;
    }

    const client = options?.trx || knex;
    const incrementBy = Number.isInteger(Number(delta)) ? Number(delta) : 1;
    await client("ai_conversations")
      .where({ id: numericConversationId })
      .update({
        message_count: client.raw("GREATEST(0, message_count + ?)", [incrementBy]),
        updated_at: new Date()
      });

    return findById(numericConversationId, {
      trx: client
    });
  }

  async function listForWorkspaceAndUser(workspaceId, actorUserId, pagination = {}, filters = {}, options = {}) {
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    const numericActorUserId = parsePositiveInteger(actorUserId);
    if (!numericWorkspaceId || !numericActorUserId) {
      return {
        items: [],
        nextCursor: null
      };
    }

    const client = options?.trx || knex;
    const { cursor, limit } = normalizeCursorPagination(pagination);

    let query = client("ai_conversations as c")
      .leftJoin("workspaces as w", "w.id", "c.workspace_id")
      .leftJoin("user_profiles as u", "u.id", "c.created_by_user_id")
      .select(
        "c.*",
        client.raw("COALESCE(w.slug, '') AS workspace_slug"),
        client.raw("COALESCE(w.name, '') AS workspace_name"),
        client.raw("COALESCE(u.display_name, '') AS created_by_user_display_name"),
        client.raw("COALESCE(u.email, '') AS created_by_user_email")
      )
      .where("c.workspace_id", numericWorkspaceId)
      .where("c.created_by_user_id", numericActorUserId);

    const normalizedStatus = normalizeText(filters.status).toLowerCase();
    if (normalizedStatus) {
      query = query.where("c.status", normalizedStatus);
    }
    if (cursor > 0) {
      query = query.where("c.id", "<", cursor);
    }

    const rows = await query
      .orderBy("c.id", "desc")
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(mapConversationRow);
    const nextCursor = hasMore && pageRows.length > 0 ? String(pageRows[pageRows.length - 1].id) : null;

    return {
      items,
      nextCursor
    };
  }

  async function transaction(callback) {
    if (typeof knex.transaction !== "function") {
      return callback(knex);
    }

    return knex.transaction(callback);
  }

  return Object.freeze({
    findById,
    findByIdForWorkspaceAndUser,
    create,
    updateById,
    incrementMessageCount,
    listForWorkspaceAndUser,
    transaction
  });
}

export { createConversationsRepository as createRepository, createConversationsRepository };
