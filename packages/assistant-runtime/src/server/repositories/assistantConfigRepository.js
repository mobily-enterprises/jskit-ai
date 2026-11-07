import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeInputRecordId, toWrittenDateTime } from "./repositoryPersistenceUtils.js";

function normalizeTargetSurfaceId(value = "") {
  return normalizeSurfaceId(value);
}

function buildScopeKey(targetSurfaceId, workspaceId = null) {
  const normalizedTargetSurfaceId = normalizeTargetSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    throw new TypeError("assistantConfigRepository requires targetSurfaceId.");
  }
  const normalizedWorkspaceId = normalizeInputRecordId(workspaceId);
  if (normalizedWorkspaceId) {
    return `${normalizedTargetSurfaceId}:workspace:${normalizedWorkspaceId}`;
  }

  return `${normalizedTargetSurfaceId}:global`;
}

function mapConfigRecord(record = {}) {
  return {
    targetSurfaceId: normalizeTargetSurfaceId(record.targetSurfaceId),
    scopeKey: normalizeText(record.scopeKey),
    workspaceId: normalizeInputRecordId(record.workspaceId),
    settings: {
      systemPrompt: String(record.systemPrompt || "")
    }
  };
}

function createDefaultRecord({ targetSurfaceId = "", workspaceId = null } = {}) {
  const normalizedTargetSurfaceId = normalizeTargetSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    throw new TypeError("assistantConfigRepository requires targetSurfaceId.");
  }
  const normalizedWorkspaceId = normalizeInputRecordId(workspaceId);

  return {
    targetSurfaceId: normalizedTargetSurfaceId,
    scopeKey: buildScopeKey(normalizedTargetSurfaceId, normalizedWorkspaceId),
    workspaceId: normalizedWorkspaceId,
    settings: {
      systemPrompt: ""
    }
  };
}

/**
 * The saved settings of each assistant surface and scope, on the assistantConfig table.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.assistantConfig
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 */
function createRepository({ assistantConfig, systemContext }) {
  const settingsContext = systemContext("global assistant settings are shared by every workspace, so they are read and written outside one");

  // A workspace's settings are read and written in that workspace; global settings in the system context.
  function scoped(workspaceId, options) {
    return { ...options, context: workspaceId ? settingsContext.forWorkspace(workspaceId) : settingsContext };
  }

  function withTransaction(options, work) {
    return assistantConfig.withTransaction(options, work, { asThrown: true });
  }

  async function findRecord(defaultRecord, options) {
    const { records } = await assistantConfig.query({
      filters: {
        targetSurfaceId: defaultRecord.targetSurfaceId,
        scopeKey: defaultRecord.scopeKey
      },
      page: { size: 1 }
    }, scoped(defaultRecord.workspaceId, options));
    return records[0] || null;
  }

  async function findByScope({ targetSurfaceId = "", workspaceId = null } = {}, options = {}) {
    const record = await findRecord(createDefaultRecord({ targetSurfaceId, workspaceId }), options);
    return record ? mapConfigRecord(record) : null;
  }

  async function upsertByScope({ targetSurfaceId = "", workspaceId = null, patch = {} } = {}, options = {}) {
    const defaultRecord = createDefaultRecord({
      targetSurfaceId,
      workspaceId
    });
    const existing = await findRecord(defaultRecord, options);
    const nextSystemPrompt = Object.hasOwn(patch, "systemPrompt")
      ? String(patch.systemPrompt || "")
      : String(existing?.systemPrompt || defaultRecord.settings.systemPrompt);
    const now = toWrittenDateTime();

    if (existing) {
      await assistantConfig.patchWhereIds([existing.id], {
        systemPrompt: nextSystemPrompt,
        updatedAt: now
      }, { ...scoped(defaultRecord.workspaceId, options), missing: "skip" });

      return {
        ...defaultRecord,
        settings: {
          systemPrompt: nextSystemPrompt
        }
      };
    }

    const created = await assistantConfig.create({
      targetSurfaceId: defaultRecord.targetSurfaceId,
      scopeKey: defaultRecord.scopeKey,
      workspaceId: defaultRecord.workspaceId,
      systemPrompt: nextSystemPrompt,
      createdAt: now,
      updatedAt: now
    }, scoped(defaultRecord.workspaceId, options));

    return mapConfigRecord(created);
  }

  return Object.freeze({
    withTransaction,
    createDefaultRecord,
    findByScope,
    upsertByScope
  });
}

export { createRepository };
