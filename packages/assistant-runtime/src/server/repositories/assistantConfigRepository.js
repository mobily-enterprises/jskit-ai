import { normalizeDbRecordId, createWithTransaction } from "@jskit-ai/database-runtime/shared";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveInsertedId } from "@jskit-ai/assistant-core/server";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function normalizeTargetSurfaceId(value = "") {
  return normalizeSurfaceId(value);
}

function normalizeWorkspaceId(value) {
  return normalizeRecordId(value, { fallback: null });
}

function normalizeWorkspaceDbId(value) {
  return normalizeDbRecordId(value, { fallback: null });
}

function buildScopeKey(targetSurfaceId, workspaceId = null) {
  const normalizedTargetSurfaceId = normalizeTargetSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    throw new TypeError("assistantConfigRepository requires targetSurfaceId.");
  }
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    return `${normalizedTargetSurfaceId}:workspace:${normalizedWorkspaceId}`;
  }

  return `${normalizedTargetSurfaceId}:global`;
}

function mapConfigRow(row = {}) {
  return {
    targetSurfaceId: normalizeTargetSurfaceId(row.target_surface_id),
    scopeKey: normalizeText(row.scope_key),
    workspaceId: normalizeWorkspaceDbId(row.workspace_id),
    settings: {
      systemPrompt: String(row.system_prompt || "")
    }
  };
}

function createDefaultRecord({ targetSurfaceId = "", workspaceId = null } = {}) {
  const normalizedTargetSurfaceId = normalizeTargetSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    throw new TypeError("assistantConfigRepository requires targetSurfaceId.");
  }
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

  return {
    targetSurfaceId: normalizedTargetSurfaceId,
    scopeKey: buildScopeKey(normalizedTargetSurfaceId, normalizedWorkspaceId),
    workspaceId: normalizedWorkspaceId,
    settings: {
      systemPrompt: ""
    }
  };
}

function createRepository(knex) {
  if (!knex || typeof knex !== "function") {
    throw new Error("createAssistantConfigRepository requires knex client.");
  }
  const withTransaction = createWithTransaction(knex);

  async function findByScope({ targetSurfaceId = "", workspaceId = null } = {}, options = {}) {
    const client = options?.trx || knex;
    const defaultRecord = createDefaultRecord({
      targetSurfaceId,
      workspaceId
    });
    const row = await client(assistantRuntimeConfig.configTable)
      .where({
        target_surface_id: defaultRecord.targetSurfaceId,
        scope_key: defaultRecord.scopeKey
      })
      .first();

    return row ? mapConfigRow(row) : null;
  }

  async function upsertByScope({ targetSurfaceId = "", workspaceId = null, patch = {} } = {}, options = {}) {
    const client = options?.trx || knex;
    const defaultRecord = createDefaultRecord({
      targetSurfaceId,
      workspaceId
    });
    const existing = await findByScope(defaultRecord, {
      trx: client
    });
    const nextSystemPrompt = Object.hasOwn(patch || {}, "systemPrompt")
      ? String(patch.systemPrompt || "")
      : String(existing?.settings?.systemPrompt || defaultRecord.settings.systemPrompt);
    const now = new Date();

    if (existing) {
      await client(assistantRuntimeConfig.configTable)
        .where({
          target_surface_id: defaultRecord.targetSurfaceId,
          scope_key: defaultRecord.scopeKey
        })
        .update({
          workspace_id: defaultRecord.workspaceId,
          system_prompt: nextSystemPrompt,
          updated_at: now
        });

      return {
        ...defaultRecord,
        settings: {
          systemPrompt: nextSystemPrompt
        }
      };
    }

    const insertResult = await client(assistantRuntimeConfig.configTable).insert({
      target_surface_id: defaultRecord.targetSurfaceId,
      scope_key: defaultRecord.scopeKey,
      workspace_id: defaultRecord.workspaceId,
      system_prompt: nextSystemPrompt,
      created_at: now,
      updated_at: now
    });
    const insertedId = resolveInsertedId(insertResult);
    if (!insertedId) {
      return {
        ...defaultRecord,
        settings: {
          systemPrompt: nextSystemPrompt
        }
      };
    }

    const insertedRow = await client(assistantRuntimeConfig.configTable)
      .where({ id: insertedId })
      .first();

    return insertedRow ? mapConfigRow(insertedRow) : {
      ...defaultRecord,
      settings: {
        systemPrompt: nextSystemPrompt
      }
    };
  }

  return Object.freeze({
    withTransaction,
    createDefaultRecord,
    findByScope,
    upsertByScope
  });
}

export { createRepository };
