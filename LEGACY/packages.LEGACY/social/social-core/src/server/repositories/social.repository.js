import { toIsoString, toDatabaseDateTimeUtc } from "@jskit-ai/jskit-knex/dateUtils";
import { isDuplicateEntryError } from "@jskit-ai/jskit-knex/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import {
  normalizeIdList,
  normalizeNullablePositiveInteger,
  normalizeNullableString,
  parseJsonObject,
  resolveClient,
  stringifyJsonObject
} from "./shared.js";

function mapActorRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    userId: row.user_id == null ? null : Number(row.user_id),
    publicChatId: row.public_chat_id == null ? null : String(row.public_chat_id),
    username: String(row.username || ""),
    displayName: String(row.display_name || ""),
    summaryText: String(row.summary_text || ""),
    actorUri: String(row.actor_uri || ""),
    inboxUrl: row.inbox_url == null ? null : String(row.inbox_url),
    sharedInboxUrl: row.shared_inbox_url == null ? null : String(row.shared_inbox_url),
    outboxUrl: row.outbox_url == null ? null : String(row.outbox_url),
    followersUrl: row.followers_url == null ? null : String(row.followers_url),
    followingUrl: row.following_url == null ? null : String(row.following_url),
    objectUri: row.object_uri == null ? null : String(row.object_uri),
    isLocal: Boolean(row.is_local),
    isSuspended: Boolean(row.is_suspended),
    lastFetchedAt: row.last_fetched_at ? toIsoString(row.last_fetched_at) : null,
    raw: parseJsonObject(row.raw_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapAttachmentRow(row) {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    mediaKind: String(row.media_kind || ""),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    url: String(row.url || ""),
    previewUrl: row.preview_url == null ? null : String(row.preview_url),
    description: row.description == null ? null : String(row.description),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    sortOrder: Number(row.sort_order || 0),
    raw: parseJsonObject(row.raw_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPostRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    actorId: Number(row.actor_id),
    objectUri: String(row.object_uri || ""),
    activityUri: row.activity_uri == null ? null : String(row.activity_uri),
    inReplyToPostId: row.in_reply_to_post_id == null ? null : Number(row.in_reply_to_post_id),
    inReplyToObjectUri: row.in_reply_to_object_uri == null ? null : String(row.in_reply_to_object_uri),
    visibility: String(row.visibility || "public"),
    contentText: String(row.content_text || ""),
    contentHtml: row.content_html == null ? null : String(row.content_html),
    language: row.language == null ? null : String(row.language),
    isLocal: Boolean(row.is_local),
    isDeleted: Boolean(row.is_deleted),
    likeCount: Number(row.like_count || 0),
    announceCount: Number(row.announce_count || 0),
    replyCount: Number(row.reply_count || 0),
    publishedAt: toIsoString(row.published_at),
    editedAt: row.edited_at ? toIsoString(row.edited_at) : null,
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : null,
    raw: parseJsonObject(row.raw_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapFollowRowNullable(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    followerActorId: Number(row.follower_actor_id),
    targetActorId: Number(row.target_actor_id),
    followUri: String(row.follow_uri || ""),
    status: String(row.status || "pending"),
    isLocalInitiated: Boolean(row.is_local_initiated),
    acceptedAt: row.accepted_at ? toIsoString(row.accepted_at) : null,
    rejectedAt: row.rejected_at ? toIsoString(row.rejected_at) : null,
    undoneAt: row.undone_at ? toIsoString(row.undone_at) : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapNotificationRow(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    userId: Number(row.user_id),
    actorId: row.actor_id == null ? null : Number(row.actor_id),
    postId: row.post_id == null ? null : Number(row.post_id),
    type: String(row.notification_type || ""),
    isRead: Boolean(row.is_read),
    payload: parseJsonObject(row.payload_json),
    createdAt: toIsoString(row.created_at),
    readAt: row.read_at ? toIsoString(row.read_at) : null
  };
}

function mapModerationRuleRow(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    ruleScope: String(row.rule_scope || ""),
    domain: row.domain == null ? null : String(row.domain),
    actorUri: row.actor_uri == null ? null : String(row.actor_uri),
    decision: String(row.decision || ""),
    reason: row.reason == null ? null : String(row.reason),
    createdByUserId: row.created_by_user_id == null ? null : Number(row.created_by_user_id),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapInboxEventRow(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    activityId: String(row.activity_id || ""),
    activityType: String(row.activity_type || ""),
    actorUri: String(row.actor_uri || ""),
    signatureKeyId: row.signature_key_id == null ? null : String(row.signature_key_id),
    signatureValid: Boolean(row.signature_valid),
    digestValid: Boolean(row.digest_valid),
    payload: parseJsonObject(row.payload_json),
    receivedAt: toIsoString(row.received_at),
    processedAt: row.processed_at ? toIsoString(row.processed_at) : null,
    processingStatus: String(row.processing_status || "received"),
    processingError: row.processing_error == null ? null : String(row.processing_error),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapOutboxRow(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    actorId: Number(row.actor_id),
    targetActorId: row.target_actor_id == null ? null : Number(row.target_actor_id),
    targetInboxUrl: String(row.target_inbox_url || ""),
    activityId: String(row.activity_id || ""),
    activityType: String(row.activity_type || ""),
    payload: parseJsonObject(row.payload_json),
    dedupeKey: String(row.dedupe_key || ""),
    status: String(row.status || "queued"),
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextAttemptAt: toIsoString(row.next_attempt_at),
    lastAttemptAt: row.last_attempt_at ? toIsoString(row.last_attempt_at) : null,
    deliveredAt: row.delivered_at ? toIsoString(row.delivered_at) : null,
    lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapActorKeyRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    actorId: Number(row.actor_id),
    keyId: String(row.key_id || ""),
    publicKeyPem: String(row.public_key_pem || ""),
    privateKeyEncrypted: String(row.private_key_encrypted || ""),
    keyAlgorithm: String(row.key_algorithm || "rsa-sha256"),
    createdAt: toIsoString(row.created_at),
    rotatedAt: row.rotated_at ? toIsoString(row.rotated_at) : null
  };
}

function createRepository(dbClient) {
  async function transaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  const actors = {
    async findById(workspaceId, actorId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_actors")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(actorId)
        })
        .first();
      return mapActorRowNullable(row);
    },
    async findByActorUri(workspaceId, actorUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActorUri = String(actorUri || "").trim();
      if (!normalizedActorUri) {
        return null;
      }
      const row = await client("social_actors")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          actor_uri: normalizedActorUri
        })
        .first();
      return mapActorRowNullable(row);
    },
    async findByUsername(workspaceId, username, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedUsername = String(username || "")
        .trim()
        .toLowerCase();
      if (!normalizedUsername) {
        return null;
      }
      const row = await client("social_actors")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          username: normalizedUsername,
          is_local: 1
        })
        .first();
      return mapActorRowNullable(row);
    },
    async findByUsernameAnyWorkspace(username, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedUsername = String(username || "")
        .trim()
        .toLowerCase();
      if (!normalizedUsername) {
        return null;
      }

      const row = await client("social_actors")
        .where({
          username: normalizedUsername,
          is_local: 1
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();

      return mapActorRowNullable(row);
    },
    async findByActorUriAnyWorkspace(actorUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActorUri = String(actorUri || "").trim();
      if (!normalizedActorUri) {
        return null;
      }

      const row = await client("social_actors")
        .where({
          actor_uri: normalizedActorUri
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();

      return mapActorRowNullable(row);
    },
    async findFirstLocal(options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_actors")
        .where({
          is_local: 1
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();
      return mapActorRowNullable(row);
    },
    async findLocalByUserId(workspaceId, userId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_actors")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          user_id: parsePositiveInteger(userId),
          is_local: 1
        })
        .first();
      return mapActorRowNullable(row);
    },
    async findLocalByPublicChatId(workspaceId, publicChatId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedPublicChatId = String(publicChatId || "")
        .trim()
        .toLowerCase();
      if (!normalizedPublicChatId) {
        return null;
      }
      const row = await client("social_actors")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          public_chat_id: normalizedPublicChatId,
          is_local: 1
        })
        .first();
      return mapActorRowNullable(row);
    },
    async listByIds(workspaceId, actorIds, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActorIds = normalizeIdList(actorIds);
      if (normalizedActorIds.length < 1) {
        return [];
      }

      const rows = await client("social_actors")
        .where({ workspace_id: parsePositiveInteger(workspaceId) })
        .whereIn("id", normalizedActorIds);

      return rows.map(mapActorRowNullable).filter(Boolean);
    },
    async search(workspaceId, { query = "", limit = 20 } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedQuery = String(query || "").trim().toLowerCase();
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

      let dbQuery = client("social_actors").where({ workspace_id: parsePositiveInteger(workspaceId) });
      if (normalizedQuery) {
        const likeValue = `%${normalizedQuery}%`;
        dbQuery = dbQuery.andWhere((builder) => {
          builder
            .where("username", "like", likeValue)
            .orWhere("display_name", "like", likeValue)
            .orWhere("actor_uri", "like", likeValue)
            .orWhere("public_chat_id", "like", likeValue);
        });
      }

      const rows = await dbQuery.orderBy("is_local", "desc").orderBy("updated_at", "desc").limit(normalizedLimit);
      return rows.map(mapActorRowNullable).filter(Boolean);
    },
    async upsert(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const actorUri = String(payload.actorUri || "").trim();
      if (!normalizedWorkspaceId || !actorUri) {
        throw new TypeError("workspaceId and payload.actorUri are required.");
      }

      const dbPatch = {
        workspace_id: normalizedWorkspaceId,
        user_id: normalizeNullablePositiveInteger(payload.userId),
        public_chat_id: normalizeNullableString(payload.publicChatId)?.toLowerCase() || null,
        username: String(payload.username || "")
          .trim()
          .toLowerCase(),
        display_name: String(payload.displayName || "").trim(),
        summary_text: String(payload.summaryText || "").trim(),
        actor_uri: actorUri,
        inbox_url: normalizeNullableString(payload.inboxUrl),
        shared_inbox_url: normalizeNullableString(payload.sharedInboxUrl),
        outbox_url: normalizeNullableString(payload.outboxUrl),
        followers_url: normalizeNullableString(payload.followersUrl),
        following_url: normalizeNullableString(payload.followingUrl),
        object_uri: normalizeNullableString(payload.objectUri),
        is_local: payload.isLocal ? 1 : 0,
        is_suspended: payload.isSuspended ? 1 : 0,
        last_fetched_at: payload.lastFetchedAt ? toDatabaseDateTimeUtc(new Date(payload.lastFetchedAt)) : null,
        raw_json: stringifyJsonObject(payload.raw || {}),
        updated_at: now
      };

      const existing = await actors.findByActorUri(normalizedWorkspaceId, actorUri, options);
      if (existing) {
        await client("social_actors")
          .where({
            workspace_id: normalizedWorkspaceId,
            id: existing.id
          })
          .update(dbPatch);
        return actors.findById(normalizedWorkspaceId, existing.id, options);
      }

      dbPatch.created_at = now;
      const [id] = await client("social_actors").insert(dbPatch);
      return actors.findById(normalizedWorkspaceId, id, options);
    }
  };

  const actorKeys = {
    async findByKeyId(workspaceId, keyId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedKeyId = String(keyId || "").trim();
      if (!normalizedKeyId) {
        return null;
      }
      const row = await client("social_actor_keys")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          key_id: normalizedKeyId
        })
        .first();
      return mapActorKeyRow(row);
    },
    async findCurrentByActorId(workspaceId, actorId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_actor_keys")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          actor_id: parsePositiveInteger(actorId)
        })
        .orderBy("created_at", "desc")
        .first();
      return mapActorKeyRow(row);
    },
    async upsert(workspaceId, actorId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActorId = parsePositiveInteger(actorId);
      const normalizedKeyId = String(payload.keyId || "").trim();
      if (!normalizedWorkspaceId || !normalizedActorId || !normalizedKeyId) {
        throw new TypeError("workspaceId, actorId, and payload.keyId are required.");
      }

      const now = toDatabaseDateTimeUtc(new Date());
      const dbPatch = {
        workspace_id: normalizedWorkspaceId,
        actor_id: normalizedActorId,
        key_id: normalizedKeyId,
        public_key_pem: String(payload.publicKeyPem || "").trim(),
        private_key_encrypted: String(payload.privateKeyEncrypted || "").trim(),
        key_algorithm: String(payload.keyAlgorithm || "rsa-sha256").trim() || "rsa-sha256",
        rotated_at: payload.rotatedAt ? toDatabaseDateTimeUtc(new Date(payload.rotatedAt)) : null,
        created_at: now
      };

      const existing = await actorKeys.findByKeyId(normalizedWorkspaceId, normalizedKeyId, options);
      if (existing) {
        await client("social_actor_keys")
          .where({
            workspace_id: normalizedWorkspaceId,
            id: existing.id
          })
          .update({
            public_key_pem: dbPatch.public_key_pem,
            private_key_encrypted: dbPatch.private_key_encrypted,
            key_algorithm: dbPatch.key_algorithm,
            rotated_at: dbPatch.rotated_at
          });
        return actorKeys.findByKeyId(normalizedWorkspaceId, normalizedKeyId, options);
      }

      const [id] = await client("social_actor_keys").insert(dbPatch);
      const row = await client("social_actor_keys")
        .where({ workspace_id: normalizedWorkspaceId, id })
        .first();
      return mapActorKeyRow(row);
    }
  };

  const posts = {
    async findByIdAnyWorkspace(postId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedPostId = parsePositiveInteger(postId);
      if (!normalizedPostId) {
        return null;
      }

      const row = await client("social_posts")
        .where({
          id: normalizedPostId
        })
        .first();
      if (!row) {
        return null;
      }

      const attachments = await client("social_post_attachments")
        .where({
          workspace_id: Number(row.workspace_id),
          post_id: Number(row.id)
        })
        .orderBy("sort_order", "asc")
        .orderBy("id", "asc");

      return {
        ...mapPostRowNullable(row),
        attachments: attachments.map(mapAttachmentRow)
      };
    },
    async findById(workspaceId, postId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_posts")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(postId)
        })
        .first();
      if (!row) {
        return null;
      }

      const attachments = await client("social_post_attachments")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          post_id: Number(row.id)
        })
        .orderBy("sort_order", "asc")
        .orderBy("id", "asc");

      return {
        ...mapPostRowNullable(row),
        attachments: attachments.map(mapAttachmentRow)
      };
    },
    async findByObjectUri(workspaceId, objectUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedObjectUri = String(objectUri || "").trim();
      if (!normalizedObjectUri) {
        return null;
      }
      const row = await client("social_posts")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          object_uri: normalizedObjectUri
        })
        .first();
      if (!row) {
        return null;
      }
      return posts.findById(workspaceId, row.id, options);
    },
    async findByActivityUri(workspaceId, activityUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActivityUri = String(activityUri || "").trim();
      if (!normalizedActivityUri) {
        return null;
      }
      const row = await client("social_posts")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          activity_uri: normalizedActivityUri
        })
        .first();
      if (!row) {
        return null;
      }
      return posts.findById(workspaceId, row.id, options);
    },
    async findByObjectUriAnyWorkspace(objectUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedObjectUri = String(objectUri || "").trim();
      if (!normalizedObjectUri) {
        return null;
      }

      const row = await client("social_posts")
        .where({
          object_uri: normalizedObjectUri
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();
      if (!row) {
        return null;
      }

      return posts.findById(Number(row.workspace_id), row.id, options);
    },
    async findByActivityUriAnyWorkspace(activityUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActivityUri = String(activityUri || "").trim();
      if (!normalizedActivityUri) {
        return null;
      }

      const row = await client("social_posts")
        .where({
          activity_uri: normalizedActivityUri
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();
      if (!row) {
        return null;
      }

      return posts.findById(Number(row.workspace_id), row.id, options);
    },
    async listFeed(workspaceId, { cursor = "", limit = 20, includeDeleted = false } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const normalizedCursor = parsePositiveInteger(cursor);

      let query = client("social_posts")
        .where({
          workspace_id: normalizedWorkspaceId
        })
        .andWhereNull("in_reply_to_post_id")
        .orderBy("id", "desc")
        .limit(normalizedLimit);

      if (!includeDeleted) {
        query = query.andWhere({ is_deleted: 0 });
      }
      if (normalizedCursor) {
        query = query.andWhere("id", "<", normalizedCursor);
      }

      const rows = await query;
      const postIds = rows.map((row) => Number(row.id));
      const attachments = postIds.length
        ? await client("social_post_attachments")
            .where({ workspace_id: normalizedWorkspaceId })
            .whereIn("post_id", postIds)
            .orderBy("sort_order", "asc")
            .orderBy("id", "asc")
        : [];

      const attachmentsByPostId = new Map();
      for (const row of attachments) {
        const key = Number(row.post_id);
        if (!attachmentsByPostId.has(key)) {
          attachmentsByPostId.set(key, []);
        }
        attachmentsByPostId.get(key).push(mapAttachmentRow(row));
      }

      return rows.map((row) => ({
        ...mapPostRowNullable(row),
        attachments: attachmentsByPostId.get(Number(row.id)) || []
      }));
    },
    async listByActor(workspaceId, actorId, { limit = 100, includeDeleted = false } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActorId = parsePositiveInteger(actorId);
      const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 100));

      let query = client("social_posts")
        .where({
          workspace_id: normalizedWorkspaceId,
          actor_id: normalizedActorId
        })
        .orderBy("id", "desc")
        .limit(normalizedLimit);

      if (!includeDeleted) {
        query = query.andWhere({ is_deleted: 0 });
      }

      const rows = await query;
      const postIds = rows.map((row) => Number(row.id));
      const attachments = postIds.length
        ? await client("social_post_attachments")
            .where({ workspace_id: normalizedWorkspaceId })
            .whereIn("post_id", postIds)
            .orderBy("sort_order", "asc")
            .orderBy("id", "asc")
        : [];

      const attachmentsByPostId = new Map();
      for (const row of attachments) {
        const key = Number(row.post_id);
        if (!attachmentsByPostId.has(key)) {
          attachmentsByPostId.set(key, []);
        }
        attachmentsByPostId.get(key).push(mapAttachmentRow(row));
      }

      return rows.map((row) => ({
        ...mapPostRowNullable(row),
        attachments: attachmentsByPostId.get(Number(row.id)) || []
      }));
    },
    async listComments(workspaceId, postId, { limit = 100 } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedPostId = parsePositiveInteger(postId);
      const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 100));

      const rows = await client("social_posts")
        .where({
          workspace_id: normalizedWorkspaceId,
          in_reply_to_post_id: normalizedPostId,
          is_deleted: 0
        })
        .orderBy("id", "asc")
        .limit(normalizedLimit);

      const postIds = rows.map((row) => Number(row.id));
      const attachments = postIds.length
        ? await client("social_post_attachments")
            .where({ workspace_id: normalizedWorkspaceId })
            .whereIn("post_id", postIds)
            .orderBy("sort_order", "asc")
            .orderBy("id", "asc")
        : [];

      const attachmentsByPostId = new Map();
      for (const row of attachments) {
        const key = Number(row.post_id);
        if (!attachmentsByPostId.has(key)) {
          attachmentsByPostId.set(key, []);
        }
        attachmentsByPostId.get(key).push(mapAttachmentRow(row));
      }

      return rows.map((row) => ({
        ...mapPostRowNullable(row),
        attachments: attachmentsByPostId.get(Number(row.id)) || []
      }));
    },
    async create(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActorId = parsePositiveInteger(payload.actorId);
      const nowDate = new Date();
      const now = toDatabaseDateTimeUtc(nowDate);

      const dbRow = {
        workspace_id: normalizedWorkspaceId,
        actor_id: normalizedActorId,
        object_uri: String(payload.objectUri || "").trim(),
        activity_uri: normalizeNullableString(payload.activityUri),
        in_reply_to_post_id: normalizeNullablePositiveInteger(payload.inReplyToPostId),
        in_reply_to_object_uri: normalizeNullableString(payload.inReplyToObjectUri),
        visibility: String(payload.visibility || "public").trim() || "public",
        content_text: String(payload.contentText || ""),
        content_html: normalizeNullableString(payload.contentHtml),
        language: normalizeNullableString(payload.language),
        is_local: payload.isLocal === false ? 0 : 1,
        is_deleted: payload.isDeleted ? 1 : 0,
        like_count: Math.max(0, Number(payload.likeCount || 0)),
        announce_count: Math.max(0, Number(payload.announceCount || 0)),
        reply_count: Math.max(0, Number(payload.replyCount || 0)),
        published_at: payload.publishedAt ? toDatabaseDateTimeUtc(new Date(payload.publishedAt)) : now,
        edited_at: payload.editedAt ? toDatabaseDateTimeUtc(new Date(payload.editedAt)) : null,
        deleted_at: payload.deletedAt ? toDatabaseDateTimeUtc(new Date(payload.deletedAt)) : null,
        raw_json: stringifyJsonObject(payload.raw || {}),
        created_at: now,
        updated_at: now
      };

      const [id] = await client("social_posts").insert(dbRow);
      if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
        const attachmentRows = payload.attachments.map((attachment, index) => ({
          workspace_id: normalizedWorkspaceId,
          post_id: Number(id),
          media_kind: String(attachment.mediaKind || "attachment").trim() || "attachment",
          mime_type: normalizeNullableString(attachment.mimeType),
          url: String(attachment.url || "").trim(),
          preview_url: normalizeNullableString(attachment.previewUrl),
          description: normalizeNullableString(attachment.description),
          width: normalizeNullablePositiveInteger(attachment.width),
          height: normalizeNullablePositiveInteger(attachment.height),
          size_bytes: normalizeNullablePositiveInteger(attachment.sizeBytes),
          sort_order: Math.max(0, Number(attachment.sortOrder ?? index) || 0),
          raw_json: stringifyJsonObject(attachment.raw || {}),
          created_at: now,
          updated_at: now
        }));
        await client("social_post_attachments").insert(attachmentRows);
      }

      if (dbRow.in_reply_to_post_id) {
        await client("social_posts")
          .where({ workspace_id: normalizedWorkspaceId, id: dbRow.in_reply_to_post_id })
          .update({
            reply_count: client.raw("GREATEST(reply_count + 1, 0)"),
            updated_at: now
          });
      }

      return posts.findById(normalizedWorkspaceId, id, options);
    },
    async update(workspaceId, postId, patch = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedPostId = parsePositiveInteger(postId);
      const now = toDatabaseDateTimeUtc(new Date());

      const dbPatch = {
        updated_at: now
      };
      if (Object.hasOwn(patch, "contentText")) {
        dbPatch.content_text = String(patch.contentText || "");
      }
      if (Object.hasOwn(patch, "contentHtml")) {
        dbPatch.content_html = normalizeNullableString(patch.contentHtml);
      }
      if (Object.hasOwn(patch, "visibility")) {
        dbPatch.visibility = String(patch.visibility || "public").trim() || "public";
      }
      if (Object.hasOwn(patch, "language")) {
        dbPatch.language = normalizeNullableString(patch.language);
      }
      if (Object.hasOwn(patch, "raw")) {
        dbPatch.raw_json = stringifyJsonObject(patch.raw || {});
      }
      if (Object.hasOwn(patch, "editedAt")) {
        dbPatch.edited_at = patch.editedAt ? toDatabaseDateTimeUtc(new Date(patch.editedAt)) : now;
      }

      await client("social_posts")
        .where({
          workspace_id: normalizedWorkspaceId,
          id: normalizedPostId
        })
        .update(dbPatch);

      if (Object.hasOwn(patch, "attachments") && Array.isArray(patch.attachments)) {
        await client("social_post_attachments")
          .where({
            workspace_id: normalizedWorkspaceId,
            post_id: normalizedPostId
          })
          .delete();

        if (patch.attachments.length > 0) {
          const attachmentRows = patch.attachments.map((attachment, index) => ({
            workspace_id: normalizedWorkspaceId,
            post_id: normalizedPostId,
            media_kind: String(attachment.mediaKind || "attachment").trim() || "attachment",
            mime_type: normalizeNullableString(attachment.mimeType),
            url: String(attachment.url || "").trim(),
            preview_url: normalizeNullableString(attachment.previewUrl),
            description: normalizeNullableString(attachment.description),
            width: normalizeNullablePositiveInteger(attachment.width),
            height: normalizeNullablePositiveInteger(attachment.height),
            size_bytes: normalizeNullablePositiveInteger(attachment.sizeBytes),
            sort_order: Math.max(0, Number(attachment.sortOrder ?? index) || 0),
            raw_json: stringifyJsonObject(attachment.raw || {}),
            created_at: now,
            updated_at: now
          }));

          await client("social_post_attachments").insert(attachmentRows);
        }
      }

      return posts.findById(normalizedWorkspaceId, normalizedPostId, options);
    },
    async softDelete(workspaceId, postId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedPostId = parsePositiveInteger(postId);
      const now = toDatabaseDateTimeUtc(new Date());

      await client("social_posts")
        .where({
          workspace_id: normalizedWorkspaceId,
          id: normalizedPostId
        })
        .update({
          is_deleted: 1,
          deleted_at: now,
          updated_at: now
        });

      return posts.findById(normalizedWorkspaceId, normalizedPostId, options);
    }
  };

  const follows = {
    async findById(workspaceId, followId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_follows")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(followId)
        })
        .first();
      return mapFollowRowNullable(row);
    },
    async findByActors(workspaceId, followerActorId, targetActorId, options = {}) {
      const client = resolveClient(dbClient, options);
      const row = await client("social_follows")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          follower_actor_id: parsePositiveInteger(followerActorId),
          target_actor_id: parsePositiveInteger(targetActorId)
        })
        .first();
      return mapFollowRowNullable(row);
    },
    async findByFollowUri(workspaceId, followUri, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedFollowUri = String(followUri || "").trim();
      if (!normalizedWorkspaceId || !normalizedFollowUri) {
        return null;
      }

      const row = await client("social_follows")
        .where({
          workspace_id: normalizedWorkspaceId,
          follow_uri: normalizedFollowUri
        })
        .first();
      return mapFollowRowNullable(row);
    },
    async createOrUpdate(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedFollowerActorId = parsePositiveInteger(payload.followerActorId);
      const normalizedTargetActorId = parsePositiveInteger(payload.targetActorId);
      if (!normalizedWorkspaceId || !normalizedFollowerActorId || !normalizedTargetActorId) {
        throw new TypeError("workspaceId, followerActorId, and targetActorId are required.");
      }

      const now = toDatabaseDateTimeUtc(new Date());
      const existing = await follows.findByActors(
        normalizedWorkspaceId,
        normalizedFollowerActorId,
        normalizedTargetActorId,
        options
      );
      const dbPatch = {
        workspace_id: normalizedWorkspaceId,
        follower_actor_id: normalizedFollowerActorId,
        target_actor_id: normalizedTargetActorId,
        follow_uri: String(payload.followUri || "").trim(),
        status: String(payload.status || "pending").trim() || "pending",
        is_local_initiated: payload.isLocalInitiated === false ? 0 : 1,
        accepted_at: payload.acceptedAt ? toDatabaseDateTimeUtc(new Date(payload.acceptedAt)) : null,
        rejected_at: payload.rejectedAt ? toDatabaseDateTimeUtc(new Date(payload.rejectedAt)) : null,
        undone_at: payload.undoneAt ? toDatabaseDateTimeUtc(new Date(payload.undoneAt)) : null,
        updated_at: now
      };

      if (existing) {
        await client("social_follows")
          .where({
            workspace_id: normalizedWorkspaceId,
            id: existing.id
          })
          .update(dbPatch);
        return follows.findById(normalizedWorkspaceId, existing.id, options);
      }

      dbPatch.created_at = now;
      const [id] = await client("social_follows").insert(dbPatch);
      return follows.findById(normalizedWorkspaceId, id, options);
    },
    async setStatus(workspaceId, followId, status, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedFollowId = parsePositiveInteger(followId);
      const normalizedStatus = String(status || "").trim() || "pending";
      const now = toDatabaseDateTimeUtc(new Date());
      const dbPatch = {
        status: normalizedStatus,
        updated_at: now
      };
      if (normalizedStatus === "accepted") {
        dbPatch.accepted_at = now;
      }
      if (normalizedStatus === "rejected") {
        dbPatch.rejected_at = now;
      }
      if (normalizedStatus === "undone") {
        dbPatch.undone_at = now;
      }

      await client("social_follows")
        .where({
          workspace_id: normalizedWorkspaceId,
          id: normalizedFollowId
        })
        .update(dbPatch);

      return follows.findById(normalizedWorkspaceId, normalizedFollowId, options);
    },
    async listFollowers(workspaceId, actorId, { limit = 100 } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const rows = await client("social_follows")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          target_actor_id: parsePositiveInteger(actorId),
          status: "accepted"
        })
        .orderBy("id", "desc")
        .limit(Math.max(1, Math.min(200, Number(limit) || 100)));

      return rows.map(mapFollowRowNullable).filter(Boolean);
    },
    async listFollowing(workspaceId, actorId, { limit = 100 } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const rows = await client("social_follows")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          follower_actor_id: parsePositiveInteger(actorId),
          status: "accepted"
        })
        .orderBy("id", "desc")
        .limit(Math.max(1, Math.min(200, Number(limit) || 100)));

      return rows.map(mapFollowRowNullable).filter(Boolean);
    }
  };

  const notifications = {
    async create(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedUserId = parsePositiveInteger(payload.userId);
      const now = toDatabaseDateTimeUtc(new Date());

      const [id] = await client("social_notifications").insert({
        workspace_id: normalizedWorkspaceId,
        user_id: normalizedUserId,
        actor_id: normalizeNullablePositiveInteger(payload.actorId),
        post_id: normalizeNullablePositiveInteger(payload.postId),
        notification_type: String(payload.type || "activity").trim() || "activity",
        payload_json: stringifyJsonObject(payload.payload || {}),
        is_read: payload.isRead ? 1 : 0,
        created_at: now,
        read_at: payload.readAt ? toDatabaseDateTimeUtc(new Date(payload.readAt)) : null
      });

      const row = await client("social_notifications")
        .where({ workspace_id: normalizedWorkspaceId, id })
        .first();
      return mapNotificationRow(row);
    },
    async listByUser(workspaceId, userId, { cursor = "", limit = 30, unreadOnly = false } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedUserId = parsePositiveInteger(userId);
      const normalizedCursor = parsePositiveInteger(cursor);
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 30));

      let query = client("social_notifications")
        .where({
          workspace_id: normalizedWorkspaceId,
          user_id: normalizedUserId
        })
        .orderBy("id", "desc")
        .limit(normalizedLimit);

      if (unreadOnly) {
        query = query.andWhere({ is_read: 0 });
      }
      if (normalizedCursor) {
        query = query.andWhere("id", "<", normalizedCursor);
      }

      const rows = await query;
      return rows.map(mapNotificationRow);
    },
    async markRead(workspaceId, userId, { notificationIds = [] } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedUserId = parsePositiveInteger(userId);
      const normalizedIds = normalizeIdList(notificationIds);
      const now = toDatabaseDateTimeUtc(new Date());

      let query = client("social_notifications")
        .where({
          workspace_id: normalizedWorkspaceId,
          user_id: normalizedUserId
        })
        .andWhere({ is_read: 0 });

      if (normalizedIds.length > 0) {
        query = query.whereIn("id", normalizedIds);
      }

      await query.update({
        is_read: 1,
        read_at: now
      });

      return true;
    }
  };

  const moderation = {
    async listRules(workspaceId, { ruleScope = "" } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      let query = client("social_moderation_rules").where({ workspace_id: parsePositiveInteger(workspaceId) });
      const normalizedScope = String(ruleScope || "").trim();
      if (normalizedScope) {
        query = query.andWhere({ rule_scope: normalizedScope });
      }

      const rows = await query.orderBy("id", "desc");
      return rows.map(mapModerationRuleRow);
    },
    async createRule(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      const [id] = await client("social_moderation_rules").insert({
        workspace_id: parsePositiveInteger(workspaceId),
        rule_scope: String(payload.ruleScope || "").trim(),
        domain: normalizeNullableString(payload.domain),
        actor_uri: normalizeNullableString(payload.actorUri),
        decision: String(payload.decision || "block").trim(),
        reason: normalizeNullableString(payload.reason),
        created_by_user_id: normalizeNullablePositiveInteger(payload.createdByUserId),
        created_at: now,
        updated_at: now
      });

      const row = await client("social_moderation_rules")
        .where({ workspace_id: parsePositiveInteger(workspaceId), id })
        .first();
      return mapModerationRuleRow(row);
    },
    async deleteRule(workspaceId, ruleId, options = {}) {
      const client = resolveClient(dbClient, options);
      await client("social_moderation_rules")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(ruleId)
        })
        .delete();
      return true;
    },
    async findBlockingRuleForActor(workspaceId, { actorUri = "", domain = "" } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActorUri = String(actorUri || "").trim();
      const normalizedDomain = String(domain || "")
        .trim()
        .toLowerCase();

      let query = client("social_moderation_rules")
        .where({
          workspace_id: normalizedWorkspaceId,
          decision: "block"
        })
        .andWhere((builder) => {
          if (normalizedActorUri) {
            builder.orWhere({ actor_uri: normalizedActorUri });
          }
          if (normalizedDomain) {
            builder.orWhere({ domain: normalizedDomain });
          }
        })
        .orderBy("id", "desc");

      const row = await query.first();
      return row ? mapModerationRuleRow(row) : null;
    }
  };

  const inboxEvents = {
    async insertOrFetch(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActivityId = String(payload.activityId || "").trim();
      if (!normalizedWorkspaceId || !normalizedActivityId) {
        throw new TypeError("workspaceId and payload.activityId are required.");
      }

      const now = toDatabaseDateTimeUtc(new Date());
      const existing = await client("social_inbox_events")
        .where({
          workspace_id: normalizedWorkspaceId,
          activity_id: normalizedActivityId
        })
        .first();
      if (existing) {
        return {
          ...mapInboxEventRow(existing),
          wasCreated: false
        };
      }

      let id = null;
      try {
        [id] = await client("social_inbox_events").insert({
          workspace_id: normalizedWorkspaceId,
          activity_id: normalizedActivityId,
          activity_type: String(payload.activityType || "").trim(),
          actor_uri: String(payload.actorUri || "").trim(),
          signature_key_id: normalizeNullableString(payload.signatureKeyId),
          signature_valid: payload.signatureValid ? 1 : 0,
          digest_valid: payload.digestValid ? 1 : 0,
          payload_json: stringifyJsonObject(payload.payload || {}),
          received_at: now,
          processed_at: payload.processedAt ? toDatabaseDateTimeUtc(new Date(payload.processedAt)) : null,
          processing_status: String(payload.processingStatus || "received").trim() || "received",
          processing_error: normalizeNullableString(payload.processingError),
          created_at: now,
          updated_at: now
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
        const duplicateRow = await client("social_inbox_events")
          .where({
            workspace_id: normalizedWorkspaceId,
            activity_id: normalizedActivityId
          })
          .first();
        if (!duplicateRow) {
          throw error;
        }
        return {
          ...mapInboxEventRow(duplicateRow),
          wasCreated: false
        };
      }

      const row = await client("social_inbox_events")
        .where({ workspace_id: normalizedWorkspaceId, id })
        .first();
      return {
        ...mapInboxEventRow(row),
        wasCreated: true
      };
    },
    async markProcessed(workspaceId, eventId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      await client("social_inbox_events")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(eventId)
        })
        .update({
          processing_status: String(payload.processingStatus || "processed").trim() || "processed",
          processing_error: normalizeNullableString(payload.processingError),
          processed_at: payload.processedAt
            ? toDatabaseDateTimeUtc(new Date(payload.processedAt))
            : toDatabaseDateTimeUtc(new Date()),
          updated_at: toDatabaseDateTimeUtc(new Date())
        });
      return true;
    },
    async countSignatureFailures(workspaceId, { actorUri = "", processingError = "signature_or_digest_invalid" } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActorUri = String(actorUri || "").trim();
      if (!normalizedWorkspaceId || !normalizedActorUri) {
        return 0;
      }

      const row = await client("social_inbox_events")
        .where({
          workspace_id: normalizedWorkspaceId,
          actor_uri: normalizedActorUri,
          processing_status: "failed",
          processing_error: String(processingError || "").trim() || "signature_or_digest_invalid"
        })
        .count({ count: "*" })
        .first();
      return Number(row?.count || 0);
    }
  };

  const outboxDeliveries = {
    async enqueue(workspaceId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedDedupeKey = String(payload.dedupeKey || "").trim();
      let id = null;
      try {
        [id] = await client("social_outbox_deliveries").insert({
          workspace_id: normalizedWorkspaceId,
          actor_id: parsePositiveInteger(payload.actorId),
          target_actor_id: normalizeNullablePositiveInteger(payload.targetActorId),
          target_inbox_url: String(payload.targetInboxUrl || "").trim(),
          activity_id: String(payload.activityId || "").trim(),
          activity_type: String(payload.activityType || "").trim(),
          payload_json: stringifyJsonObject(payload.payload || {}),
          dedupe_key: normalizedDedupeKey,
          status: String(payload.status || "queued").trim() || "queued",
          attempt_count: Math.max(0, Number(payload.attemptCount || 0)),
          max_attempts: Math.max(1, Number(payload.maxAttempts || 8)),
          next_attempt_at: payload.nextAttemptAt ? toDatabaseDateTimeUtc(new Date(payload.nextAttemptAt)) : now,
          last_attempt_at: payload.lastAttemptAt ? toDatabaseDateTimeUtc(new Date(payload.lastAttemptAt)) : null,
          delivered_at: payload.deliveredAt ? toDatabaseDateTimeUtc(new Date(payload.deliveredAt)) : null,
          last_http_status: payload.lastHttpStatus == null ? null : Number(payload.lastHttpStatus),
          last_error: normalizeNullableString(payload.lastError),
          created_at: now,
          updated_at: now
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) {
          throw error;
        }
        const duplicate = await client("social_outbox_deliveries")
          .where({
            workspace_id: normalizedWorkspaceId,
            dedupe_key: normalizedDedupeKey
          })
          .first();
        if (!duplicate) {
          throw error;
        }
        return mapOutboxRow(duplicate);
      }

      const row = await client("social_outbox_deliveries")
        .where({ workspace_id: normalizedWorkspaceId, id })
        .first();
      return mapOutboxRow(row);
    },
    async findByActivityId(workspaceId, activityId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedActivityId = String(activityId || "").trim();
      if (!normalizedWorkspaceId || !normalizedActivityId) {
        return null;
      }

      const row = await client("social_outbox_deliveries")
        .where({
          workspace_id: normalizedWorkspaceId,
          activity_id: normalizedActivityId
        })
        .orderBy("id", "asc")
        .first();
      return row ? mapOutboxRow(row) : null;
    },
    async findByActivityIdAnyWorkspace(activityId, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedActivityId = String(activityId || "").trim();
      if (!normalizedActivityId) {
        return null;
      }

      const row = await client("social_outbox_deliveries")
        .where({
          activity_id: normalizedActivityId
        })
        .orderBy("workspace_id", "asc")
        .orderBy("id", "asc")
        .first();
      return row ? mapOutboxRow(row) : null;
    },
    async listReadyWorkspaceIds({ now = new Date(), limit = 25 } = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const normalizedNow = toDatabaseDateTimeUtc(new Date(now));
      const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 25));

      const rows = await client("social_outbox_deliveries")
        .select("workspace_id")
        .whereIn("status", ["queued", "retrying"])
        .andWhere("next_attempt_at", "<=", normalizedNow)
        .groupBy("workspace_id")
        .orderBy("workspace_id", "asc")
        .limit(normalizedLimit);

      return rows.map((row) => Number(row.workspace_id)).filter((value) => Number.isInteger(value) && value > 0);
    },
    async leaseReadyBatch(
      workspaceId,
      { now = new Date(), limit = 20, processingStatus = "processing" } = {},
      options = {}
    ) {
      const client = resolveClient(dbClient, options);
      const normalizedWorkspaceId = parsePositiveInteger(workspaceId);
      const normalizedNow = toDatabaseDateTimeUtc(new Date(now));
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

      return transaction(async (trx) => {
        const scoped = resolveClient(dbClient, { trx });
        const rows = await scoped("social_outbox_deliveries")
          .where({ workspace_id: normalizedWorkspaceId })
          .whereIn("status", ["queued", "retrying"])
          .andWhere("next_attempt_at", "<=", normalizedNow)
          .orderBy("id", "asc")
          .limit(normalizedLimit);

        const ids = rows.map((row) => Number(row.id)).filter(Boolean);
        if (ids.length < 1) {
          return [];
        }

        await scoped("social_outbox_deliveries")
          .where({ workspace_id: normalizedWorkspaceId })
          .whereIn("id", ids)
          .update({
            status: processingStatus,
            updated_at: normalizedNow
          });

        return rows.map(mapOutboxRow);
      });
    },
    async markDelivered(workspaceId, deliveryId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      await client("social_outbox_deliveries")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(deliveryId)
        })
        .update({
          status: "delivered",
          attempt_count: Math.max(0, Number(payload.attemptCount || 0)),
          last_http_status: payload.lastHttpStatus == null ? 202 : Number(payload.lastHttpStatus),
          delivered_at: now,
          last_attempt_at: now,
          last_error: null,
          updated_at: now
        });
      return true;
    },
    async markRetry(workspaceId, deliveryId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      const nextAttemptAt = payload.nextAttemptAt ? toDatabaseDateTimeUtc(new Date(payload.nextAttemptAt)) : now;
      await client("social_outbox_deliveries")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(deliveryId)
        })
        .update({
          status: "retrying",
          attempt_count: Math.max(0, Number(payload.attemptCount || 0)),
          last_http_status: payload.lastHttpStatus == null ? null : Number(payload.lastHttpStatus),
          next_attempt_at: nextAttemptAt,
          last_attempt_at: now,
          last_error: normalizeNullableString(payload.lastError),
          updated_at: now
        });
      return true;
    },
    async markDead(workspaceId, deliveryId, payload = {}, options = {}) {
      const client = resolveClient(dbClient, options);
      const now = toDatabaseDateTimeUtc(new Date());
      await client("social_outbox_deliveries")
        .where({
          workspace_id: parsePositiveInteger(workspaceId),
          id: parsePositiveInteger(deliveryId)
        })
        .update({
          status: "dead",
          attempt_count: Math.max(0, Number(payload.attemptCount || 0)),
          last_http_status: payload.lastHttpStatus == null ? null : Number(payload.lastHttpStatus),
          last_attempt_at: now,
          last_error: normalizeNullableString(payload.lastError),
          updated_at: now
        });
      return true;
    }
  };

  return {
    actors,
    actorKeys,
    posts,
    follows,
    notifications,
    moderation,
    inboxEvents,
    outboxDeliveries,
    transaction
  };
}

const __testables = {
  mapActorRowNullable,
  mapPostRowNullable,
  mapFollowRowNullable,
  mapNotificationRow,
  mapModerationRuleRow,
  mapInboxEventRow,
  mapOutboxRow,
  mapActorKeyRow
};

export { createRepository, __testables };
