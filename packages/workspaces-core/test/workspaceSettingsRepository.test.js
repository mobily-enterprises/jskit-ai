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

          return {
            data: [{
              type: "workspaceSettings",
              id: String(state.row.id),
              attributes: {
                lightPrimaryColor: state.row.lightPrimaryColor,
                lightSecondaryColor: state.row.lightSecondaryColor,
                lightSurfaceColor: state.row.lightSurfaceColor,
                lightSurfaceVariantColor: state.row.lightSurfaceVariantColor,
                darkPrimaryColor: state.row.darkPrimaryColor,
                darkSecondaryColor: state.row.darkSecondaryColor,
                darkSurfaceColor: state.row.darkSurfaceColor,
                darkSurfaceVariantColor: state.row.darkSurfaceVariantColor,
                invitesEnabled: state.row.invitesEnabled,
                createdAt: state.row.createdAt,
                updatedAt: state.row.updatedAt
              }
            }]
          };
        },
        async post(payload) {
          assert.equal(payload?.simplified, false);
          const inputRecord = payload?.inputRecord?.data || {};
          const attributes = inputRecord.attributes || {};
          state.postPayload = inputRecord;
          state.row = {
            id: String(inputRecord.id),
            lightPrimaryColor: normalizeWorkspaceColor(attributes.lightPrimaryColor ?? DEFAULT_WORKSPACE_THEME.light.color),
            lightSecondaryColor: normalizeWorkspaceColor(attributes.lightSecondaryColor ?? DEFAULT_WORKSPACE_THEME.light.secondaryColor),
            lightSurfaceColor: normalizeWorkspaceColor(attributes.lightSurfaceColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceColor),
            lightSurfaceVariantColor: normalizeWorkspaceColor(attributes.lightSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor),
            darkPrimaryColor: normalizeWorkspaceColor(attributes.darkPrimaryColor ?? DEFAULT_WORKSPACE_THEME.dark.color),
            darkSecondaryColor: normalizeWorkspaceColor(attributes.darkSecondaryColor ?? DEFAULT_WORKSPACE_THEME.dark.secondaryColor),
            darkSurfaceColor: normalizeWorkspaceColor(attributes.darkSurfaceColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceColor),
            darkSurfaceVariantColor: normalizeWorkspaceColor(attributes.darkSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor),
            invitesEnabled: attributes.invitesEnabled ?? true,
            createdAt: toIsoString("2026-03-10 00:00:00.000"),
            updatedAt: toIsoString("2026-03-10 00:00:00.000")
          };
          return {
            data: {
              type: "workspaceSettings",
              id: String(state.row.id),
              attributes: {
                ...state.row
              }
            }
          };
        },
        async patch(payload) {
          assert.equal(payload?.simplified, false);
          const inputRecord = payload?.inputRecord?.data || {};
          const attributes = inputRecord.attributes || {};
          state.patchPayload = inputRecord;
          state.row = {
            ...state.row,
            ...attributes,
            ...(Object.hasOwn(attributes, "lightPrimaryColor") ? { lightPrimaryColor: normalizeWorkspaceColor(attributes.lightPrimaryColor) } : {}),
            ...(Object.hasOwn(attributes, "lightSecondaryColor") ? { lightSecondaryColor: normalizeWorkspaceColor(attributes.lightSecondaryColor) } : {}),
            ...(Object.hasOwn(attributes, "lightSurfaceColor") ? { lightSurfaceColor: normalizeWorkspaceColor(attributes.lightSurfaceColor) } : {}),
            ...(Object.hasOwn(attributes, "lightSurfaceVariantColor") ? { lightSurfaceVariantColor: normalizeWorkspaceColor(attributes.lightSurfaceVariantColor) } : {}),
            ...(Object.hasOwn(attributes, "darkPrimaryColor") ? { darkPrimaryColor: normalizeWorkspaceColor(attributes.darkPrimaryColor) } : {}),
            ...(Object.hasOwn(attributes, "darkSecondaryColor") ? { darkSecondaryColor: normalizeWorkspaceColor(attributes.darkSecondaryColor) } : {}),
            ...(Object.hasOwn(attributes, "darkSurfaceColor") ? { darkSurfaceColor: normalizeWorkspaceColor(attributes.darkSurfaceColor) } : {}),
            ...(Object.hasOwn(attributes, "darkSurfaceVariantColor") ? { darkSurfaceVariantColor: normalizeWorkspaceColor(attributes.darkSurfaceVariantColor) } : {}),
            id: String(inputRecord.id || state.row?.id || "")
          };
          return {
            data: {
              type: "workspaceSettings",
              id: String(state.row.id),
              attributes: {
                ...state.row
              }
            }
          };
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

  assert.equal(state.patchPayload.attributes?.invitesEnabled, false);
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
  assert.equal(state.postPayload.attributes?.lightPrimaryColor, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(state.postPayload.attributes?.lightSecondaryColor, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(state.postPayload.attributes?.lightSurfaceColor, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(state.postPayload.attributes?.lightSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor);
  assert.equal(state.postPayload.attributes?.darkPrimaryColor, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(state.postPayload.attributes?.darkSecondaryColor, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(state.postPayload.attributes?.darkSurfaceColor, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(state.postPayload.attributes?.darkSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor);
  assert.equal(state.postPayload.attributes?.invitesEnabled, true);
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

  assert.equal(state.patchPayload.attributes?.lightPrimaryColor, "#123abc");
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
