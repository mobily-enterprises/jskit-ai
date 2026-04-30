import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { resolveWorkspaceThemePalettes } from "@jskit-ai/workspaces-core/shared/settings";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createKnexStub() {
  const knex = Object.assign(() => {
    throw new Error("query execution not expected");
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return knex;
}

function normalizeWorkspaceColor(value) {
  return typeof value === "string" ? value.toUpperCase() : value;
}

function createWorkspaceSettingsApiStub(rowOverrides = {}) {
  const DEFAULT_WORKSPACE_THEME = resolveWorkspaceThemePalettes({});
  const STUB_CREATED_AT = "2026-03-09 00:26:35.710";
  const STUB_CREATED_AT_ISO = toIsoString(STUB_CREATED_AT);

  const state = {
    postPayload: null,
    patchPayload: null,
    row: {
      id: "1",
      lightPrimaryColor: DEFAULT_WORKSPACE_THEME.light.color,
      lightSecondaryColor: DEFAULT_WORKSPACE_THEME.light.secondaryColor,
      lightSurfaceColor: DEFAULT_WORKSPACE_THEME.light.surfaceColor,
      lightSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor,
      darkPrimaryColor: DEFAULT_WORKSPACE_THEME.dark.color,
      darkSecondaryColor: DEFAULT_WORKSPACE_THEME.dark.secondaryColor,
      darkSurfaceColor: DEFAULT_WORKSPACE_THEME.dark.surfaceColor,
      darkSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor,
      invitesEnabled: true,
      createdAt: STUB_CREATED_AT_ISO,
      updatedAt: STUB_CREATED_AT_ISO,
      ...rowOverrides
    }
  };

  const api = {
    resources: {
      workspaceSettings: {
        async query({ queryParams }) {
          const id = String(queryParams?.filters?.id || "");
          if (!state.row || (id && String(state.row.id) !== id)) {
            return { data: [] };
          }

          return { data: [{ ...state.row }] };
        },
        async post(payload) {
          assert.equal(payload?.simplified, true);
          const inputRecord = payload?.inputRecord || {};
          state.postPayload = { ...inputRecord };
          state.row = {
            id: String(inputRecord.id),
            lightPrimaryColor: normalizeWorkspaceColor(inputRecord.lightPrimaryColor ?? DEFAULT_WORKSPACE_THEME.light.color),
            lightSecondaryColor: normalizeWorkspaceColor(inputRecord.lightSecondaryColor ?? DEFAULT_WORKSPACE_THEME.light.secondaryColor),
            lightSurfaceColor: normalizeWorkspaceColor(inputRecord.lightSurfaceColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceColor),
            lightSurfaceVariantColor: normalizeWorkspaceColor(inputRecord.lightSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor),
            darkPrimaryColor: normalizeWorkspaceColor(inputRecord.darkPrimaryColor ?? DEFAULT_WORKSPACE_THEME.dark.color),
            darkSecondaryColor: normalizeWorkspaceColor(inputRecord.darkSecondaryColor ?? DEFAULT_WORKSPACE_THEME.dark.secondaryColor),
            darkSurfaceColor: normalizeWorkspaceColor(inputRecord.darkSurfaceColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceColor),
            darkSurfaceVariantColor: normalizeWorkspaceColor(inputRecord.darkSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor),
            invitesEnabled: inputRecord.invitesEnabled ?? true,
            createdAt: toIsoString("2026-03-10 00:00:00.000"),
            updatedAt: toIsoString("2026-03-10 00:00:00.000")
          };
          return { ...state.row };
        },
        async patch(payload) {
          assert.equal(payload?.simplified, true);
          const inputRecord = payload?.inputRecord || {};
          state.patchPayload = { ...inputRecord };
          state.row = {
            ...state.row,
            ...inputRecord,
            ...(Object.hasOwn(inputRecord, "lightPrimaryColor") ? { lightPrimaryColor: normalizeWorkspaceColor(inputRecord.lightPrimaryColor) } : {}),
            ...(Object.hasOwn(inputRecord, "lightSecondaryColor") ? { lightSecondaryColor: normalizeWorkspaceColor(inputRecord.lightSecondaryColor) } : {}),
            ...(Object.hasOwn(inputRecord, "lightSurfaceColor") ? { lightSurfaceColor: normalizeWorkspaceColor(inputRecord.lightSurfaceColor) } : {}),
            ...(Object.hasOwn(inputRecord, "lightSurfaceVariantColor") ? { lightSurfaceVariantColor: normalizeWorkspaceColor(inputRecord.lightSurfaceVariantColor) } : {}),
            ...(Object.hasOwn(inputRecord, "darkPrimaryColor") ? { darkPrimaryColor: normalizeWorkspaceColor(inputRecord.darkPrimaryColor) } : {}),
            ...(Object.hasOwn(inputRecord, "darkSecondaryColor") ? { darkSecondaryColor: normalizeWorkspaceColor(inputRecord.darkSecondaryColor) } : {}),
            ...(Object.hasOwn(inputRecord, "darkSurfaceColor") ? { darkSurfaceColor: normalizeWorkspaceColor(inputRecord.darkSurfaceColor) } : {}),
            ...(Object.hasOwn(inputRecord, "darkSurfaceVariantColor") ? { darkSurfaceVariantColor: normalizeWorkspaceColor(inputRecord.darkSurfaceVariantColor) } : {}),
            id: String(inputRecord.id || state.row?.id || "")
          };
          return { ...state.row };
        }
      }
    }
  };

  return { api, state, DEFAULT_WORKSPACE_THEME, STUB_CREATED_AT };
}

test("workspaceSettingsRepository.findByWorkspaceId returns the canonical workspace-settings row", async () => {
  const { api, DEFAULT_WORKSPACE_THEME, STUB_CREATED_AT } = createWorkspaceSettingsApiStub();
  const repository = createRepository({
    api,
    knex: createKnexStub()
  });

  const record = await repository.findByWorkspaceId("1");

  assert.deepEqual(record, {
    id: "1",
    lightPrimaryColor: DEFAULT_WORKSPACE_THEME.light.color,
    lightSecondaryColor: DEFAULT_WORKSPACE_THEME.light.secondaryColor,
    lightSurfaceColor: DEFAULT_WORKSPACE_THEME.light.surfaceColor,
    lightSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor,
    darkPrimaryColor: DEFAULT_WORKSPACE_THEME.dark.color,
    darkSecondaryColor: DEFAULT_WORKSPACE_THEME.dark.secondaryColor,
    darkSurfaceColor: DEFAULT_WORKSPACE_THEME.dark.surfaceColor,
    darkSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor,
    invitesEnabled: true,
    createdAt: toIsoString(STUB_CREATED_AT),
    updatedAt: toIsoString(STUB_CREATED_AT)
  });
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId updates invitesEnabled only", async () => {
  const { api, state } = createWorkspaceSettingsApiStub();
  const repository = createRepository({
    api,
    knex: createKnexStub()
  });

  const updated = await repository.updateSettingsByWorkspaceId("1", {
    invitesEnabled: false
  });

  assert.equal(state.patchPayload.invitesEnabled, false);
  assert.equal(updated.invitesEnabled, false);
});

test("workspaceSettingsRepository.ensureForWorkspaceId delegates defaults to the resource create path", async () => {
  const { api, state, DEFAULT_WORKSPACE_THEME } = createWorkspaceSettingsApiStub();
  state.row = null;
  const repository = createRepository({
    api,
    knex: createKnexStub()
  });

  const record = await repository.ensureForWorkspaceId("5");

  assert.equal(state.postPayload.id, "5");
  assert.equal(state.postPayload.lightPrimaryColor, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(state.postPayload.lightSecondaryColor, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(state.postPayload.lightSurfaceColor, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(state.postPayload.lightSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor);
  assert.equal(state.postPayload.darkPrimaryColor, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(state.postPayload.darkSecondaryColor, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(state.postPayload.darkSurfaceColor, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(state.postPayload.darkSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor);
  assert.equal(state.postPayload.invitesEnabled, true);
  assert.equal(record.lightPrimaryColor, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(record.lightSecondaryColor, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(record.lightSurfaceColor, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(record.lightSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor);
  assert.equal(record.darkPrimaryColor, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(record.darkSecondaryColor, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(record.darkSurfaceColor, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(record.darkSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor);
  assert.equal(record.invitesEnabled, true);
  assert.equal(record.id, "5");
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId updates workspace settings fields", async () => {
  const { api, state } = createWorkspaceSettingsApiStub();
  const repository = createRepository({
    api,
    knex: createKnexStub()
  });

  const updated = await repository.updateSettingsByWorkspaceId("1", {
    lightPrimaryColor: "#123abc"
  });

  assert.equal(state.patchPayload.lightPrimaryColor, "#123abc");
  assert.equal(updated.lightPrimaryColor, "#123ABC");
});

test("workspaceSettingsRepository can be constructed without validating app config shape", () => {
  const { api } = createWorkspaceSettingsApiStub();

  const repository = createRepository({
    api,
    knex: createKnexStub()
  });

  assert.ok(repository);
});
