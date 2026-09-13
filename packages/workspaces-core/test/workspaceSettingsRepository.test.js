import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { resolveWorkspaceThemePalettes } from "@jskit-ai/workspaces-core/shared/settings";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function normalizeWorkspaceColor(value) {
  return typeof value === "string" ? value.toUpperCase() : value;
}

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
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
        async query({ queryParams, format }) {
          assert.equal(format, "plain");
          const id = String(queryParams?.filters?.id || "");
          if (!state.row || (id && String(state.row.id) !== id)) {
            return asCollectionDocument([]);
          }

          return asCollectionDocument([{
            ...state.row,
            id: String(state.row.id)
          }]);
        },
        async post(payload) {
          const data = payload?.data || {};
          assert.equal(payload.format, "plain");
          assert.equal(payload.returning, "full");
          assert.equal(payload.inputRecord, undefined);
          assert.equal(payload.document, undefined);
          state.postPayload = payload;
          state.row = {
            id: String(data.id),
            lightPrimaryColor: normalizeWorkspaceColor(data.lightPrimaryColor ?? DEFAULT_WORKSPACE_THEME.light.color),
            lightSecondaryColor: normalizeWorkspaceColor(data.lightSecondaryColor ?? DEFAULT_WORKSPACE_THEME.light.secondaryColor),
            lightSurfaceColor: normalizeWorkspaceColor(data.lightSurfaceColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceColor),
            lightSurfaceVariantColor: normalizeWorkspaceColor(data.lightSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor),
            darkPrimaryColor: normalizeWorkspaceColor(data.darkPrimaryColor ?? DEFAULT_WORKSPACE_THEME.dark.color),
            darkSecondaryColor: normalizeWorkspaceColor(data.darkSecondaryColor ?? DEFAULT_WORKSPACE_THEME.dark.secondaryColor),
            darkSurfaceColor: normalizeWorkspaceColor(data.darkSurfaceColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceColor),
            darkSurfaceVariantColor: normalizeWorkspaceColor(data.darkSurfaceVariantColor ?? DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor),
            invitesEnabled: data.invitesEnabled ?? true,
            createdAt: toIsoString("2026-03-10 00:00:00.000"),
            updatedAt: toIsoString("2026-03-10 00:00:00.000")
          };
          return {
            ...state.row,
            id: String(state.row.id)
          };
        },
        async patch(payload) {
          const data = payload?.data || {};
          assert.equal(payload.format, "plain");
          assert.equal(payload.returning, "full");
          assert.equal(payload.inputRecord, undefined);
          assert.equal(payload.document, undefined);
          state.patchPayload = payload;
          state.row = {
            ...state.row,
            ...data,
            ...(Object.hasOwn(data, "lightPrimaryColor") ? { lightPrimaryColor: normalizeWorkspaceColor(data.lightPrimaryColor) } : {}),
            ...(Object.hasOwn(data, "lightSecondaryColor") ? { lightSecondaryColor: normalizeWorkspaceColor(data.lightSecondaryColor) } : {}),
            ...(Object.hasOwn(data, "lightSurfaceColor") ? { lightSurfaceColor: normalizeWorkspaceColor(data.lightSurfaceColor) } : {}),
            ...(Object.hasOwn(data, "lightSurfaceVariantColor") ? { lightSurfaceVariantColor: normalizeWorkspaceColor(data.lightSurfaceVariantColor) } : {}),
            ...(Object.hasOwn(data, "darkPrimaryColor") ? { darkPrimaryColor: normalizeWorkspaceColor(data.darkPrimaryColor) } : {}),
            ...(Object.hasOwn(data, "darkSecondaryColor") ? { darkSecondaryColor: normalizeWorkspaceColor(data.darkSecondaryColor) } : {}),
            ...(Object.hasOwn(data, "darkSurfaceColor") ? { darkSurfaceColor: normalizeWorkspaceColor(data.darkSurfaceColor) } : {}),
            ...(Object.hasOwn(data, "darkSurfaceVariantColor") ? { darkSurfaceVariantColor: normalizeWorkspaceColor(data.darkSurfaceVariantColor) } : {}),
            id: String(payload.id || state.row?.id || "")
          };
          return {
            ...state.row,
            id: String(state.row.id)
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
    api
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
    api
  });

  const updated = await repository.updateSettingsByWorkspaceId("1", {
    invitesEnabled: false
  });

  assert.equal(state.patchPayload.data.invitesEnabled, false);
  assert.equal(updated.invitesEnabled, false);
});

test("workspaceSettingsRepository.ensureForWorkspaceId delegates defaults to the resource create path", async () => {
  const { api, state, DEFAULT_WORKSPACE_THEME } = createWorkspaceSettingsApiStub();
  state.row = null;
  const repository = createRepository({
    api
  });

  const record = await repository.ensureForWorkspaceId("5");

  assert.equal(state.postPayload.data.id, "5");
  assert.equal(state.postPayload.data.lightPrimaryColor, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(state.postPayload.data.lightSecondaryColor, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(state.postPayload.data.lightSurfaceColor, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(state.postPayload.data.lightSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor);
  assert.equal(state.postPayload.data.darkPrimaryColor, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(state.postPayload.data.darkSecondaryColor, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(state.postPayload.data.darkSurfaceColor, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(state.postPayload.data.darkSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor);
  assert.equal(state.postPayload.data.invitesEnabled, true);
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
    api
  });

  const updated = await repository.updateSettingsByWorkspaceId("1", {
    lightPrimaryColor: "#123abc"
  });

  assert.equal(state.patchPayload.data.lightPrimaryColor, "#123abc");
  assert.equal(updated.lightPrimaryColor, "#123ABC");
});

test("workspaceSettingsRepository can be constructed without validating app config shape", () => {
  const { api } = createWorkspaceSettingsApiStub();

  const repository = createRepository({
    api
  });

  assert.ok(repository);
});
