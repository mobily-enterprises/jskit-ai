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
          state.postPayload = { ...payload };
          state.row = {
            id: String(payload.id),
            lightPrimaryColor: normalizeWorkspaceColor(payload.lightPrimaryColor ?? DEFAULT_WORKSPACE_THEME.light.color),
            lightSecondaryColor: normalizeWorkspaceColor(payload.lightSecondaryColor ?? DEFAULT_WORKSPACE_THEME.light.secondaryColor),
            lightSurfaceColor: normalizeWorkspaceColor(payload.lightSurfaceColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceColor),
            lightSurfaceVariantColor: normalizeWorkspaceColor(payload.lightSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor),
            darkPrimaryColor: normalizeWorkspaceColor(payload.darkPrimaryColor ?? DEFAULT_WORKSPACE_THEME.dark.color),
            darkSecondaryColor: normalizeWorkspaceColor(payload.darkSecondaryColor ?? DEFAULT_WORKSPACE_THEME.dark.secondaryColor),
            darkSurfaceColor: normalizeWorkspaceColor(payload.darkSurfaceColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceColor),
            darkSurfaceVariantColor: normalizeWorkspaceColor(payload.darkSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor),
            invitesEnabled: payload.invitesEnabled ?? true,
            createdAt: toIsoString("2026-03-10 00:00:00.000"),
            updatedAt: toIsoString("2026-03-10 00:00:00.000")
          };
          return { ...state.row };
        },
        async patch(payload) {
          state.patchPayload = { ...payload };
          state.row = {
            ...state.row,
            ...payload,
            ...(Object.hasOwn(payload, "lightPrimaryColor") ? { lightPrimaryColor: normalizeWorkspaceColor(payload.lightPrimaryColor) } : {}),
            ...(Object.hasOwn(payload, "lightSecondaryColor") ? { lightSecondaryColor: normalizeWorkspaceColor(payload.lightSecondaryColor) } : {}),
            ...(Object.hasOwn(payload, "lightSurfaceColor") ? { lightSurfaceColor: normalizeWorkspaceColor(payload.lightSurfaceColor) } : {}),
            ...(Object.hasOwn(payload, "lightSurfaceVariantColor") ? { lightSurfaceVariantColor: normalizeWorkspaceColor(payload.lightSurfaceVariantColor) } : {}),
            ...(Object.hasOwn(payload, "darkPrimaryColor") ? { darkPrimaryColor: normalizeWorkspaceColor(payload.darkPrimaryColor) } : {}),
            ...(Object.hasOwn(payload, "darkSecondaryColor") ? { darkSecondaryColor: normalizeWorkspaceColor(payload.darkSecondaryColor) } : {}),
            ...(Object.hasOwn(payload, "darkSurfaceColor") ? { darkSurfaceColor: normalizeWorkspaceColor(payload.darkSurfaceColor) } : {}),
            ...(Object.hasOwn(payload, "darkSurfaceVariantColor") ? { darkSurfaceVariantColor: normalizeWorkspaceColor(payload.darkSurfaceVariantColor) } : {}),
            id: String(payload.id || state.row?.id || "")
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
  assert.equal(Object.keys(state.postPayload).includes("lightPrimaryColor"), false);
  assert.equal(Object.keys(state.postPayload).includes("invitesEnabled"), false);
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
