import assert from "node:assert/strict";
import test from "node:test";
import "../test-support/registerDefaultSettingsFields.js";
import { resolveWorkspaceThemePalette } from "../src/shared/settings.js";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createDefaultWorkspaceSettings() {
  return true;
}

const DEFAULT_WORKSPACE_THEME = resolveWorkspaceThemePalette({
  color: "#2F5D9E"
});

function createKnexStub(rowOverrides = {}) {
  const state = {
    insertedRow: null,
    updatePayload: null,
    row: {
      workspace_id: 1,
      name: "Workspace",
      avatar_url: "",
      color: "#2F5D9E",
      secondary_color: DEFAULT_WORKSPACE_THEME.secondaryColor,
      surface_color: DEFAULT_WORKSPACE_THEME.surfaceColor,
      surface_variant_color: DEFAULT_WORKSPACE_THEME.surfaceVariantColor,
      invites_enabled: 1,
      created_at: "2026-03-09 00:26:35.710",
      updated_at: "2026-03-09 00:26:35.710",
      ...rowOverrides
    }
  };

  function tableBuilder(tableName) {
    assert.equal(tableName, "workspace_settings");

    return {
      insert(payload) {
        state.insertedRow = { ...payload };
        state.row = {
          workspace_id: payload.workspace_id,
          name: payload.name,
          avatar_url: payload.avatar_url,
          color: payload.color,
          secondary_color: payload.secondary_color,
          surface_color: payload.surface_color,
          surface_variant_color: payload.surface_variant_color,
          invites_enabled: payload.invites_enabled,
          created_at: "2026-03-10 00:00:00.000",
          updated_at: "2026-03-10 00:00:00.000"
        };
        return Promise.resolve([1]);
      },
      where(criteria) {
        assert.equal(typeof criteria, "object");

        return {
          first() {
            return Promise.resolve(state.row ? { ...state.row } : null);
          },
          update(payload) {
            state.updatePayload = payload;
            if (Object.hasOwn(payload, "invites_enabled")) {
              state.row.invites_enabled = payload.invites_enabled;
            }
            if (Object.hasOwn(payload, "name")) {
              state.row.name = payload.name;
            }
            if (Object.hasOwn(payload, "avatar_url")) {
              state.row.avatar_url = payload.avatar_url;
            }
            if (Object.hasOwn(payload, "color")) {
              state.row.color = payload.color;
            }
            if (Object.hasOwn(payload, "secondary_color")) {
              state.row.secondary_color = payload.secondary_color;
            }
            if (Object.hasOwn(payload, "surface_color")) {
              state.row.surface_color = payload.surface_color;
            }
            if (Object.hasOwn(payload, "surface_variant_color")) {
              state.row.surface_variant_color = payload.surface_variant_color;
            }
            if (Object.hasOwn(payload, "updated_at")) {
              state.row.updated_at = payload.updated_at;
            }
            return Promise.resolve(1);
          }
        };
      }
    };
  }

  return { knexStub: tableBuilder, state };
}

test("workspaceSettingsRepository.findByWorkspaceId maps the stored row", async () => {
  const { knexStub } = createKnexStub();
  const repository = createRepository(knexStub, {
    defaultInvitesEnabled: createDefaultWorkspaceSettings()
  });

  const record = await repository.findByWorkspaceId(1);

  assert.deepEqual(record, {
    workspaceId: 1,
    name: "Workspace",
    avatarUrl: "",
    color: "#2F5D9E",
    secondaryColor: DEFAULT_WORKSPACE_THEME.secondaryColor,
    surfaceColor: DEFAULT_WORKSPACE_THEME.surfaceColor,
    surfaceVariantColor: DEFAULT_WORKSPACE_THEME.surfaceVariantColor,
    invitesEnabled: true,
    createdAt: "2026-03-08T16:26:35.710Z",
    updatedAt: "2026-03-08T16:26:35.710Z"
  });
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId updates invitesEnabled only", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub, {
    defaultInvitesEnabled: createDefaultWorkspaceSettings()
  });

  const updated = await repository.updateSettingsByWorkspaceId(1, {
    invitesEnabled: false
  });

  assert.equal(state.updatePayload.invites_enabled, false);
  assert.equal(updated.invitesEnabled, false);
});

test("workspaceSettingsRepository.ensureForWorkspaceId inserts the injected defaults exactly", async () => {
  const { knexStub, state } = createKnexStub();
  state.row = null;
  const repository = createRepository(knexStub, {
    defaultInvitesEnabled: false
  });

  const record = await repository.ensureForWorkspaceId(5);

  assert.equal(state.insertedRow.workspace_id, 5);
  assert.equal(state.insertedRow.name, "Workspace");
  assert.equal(state.insertedRow.avatar_url, "");
  assert.equal(state.insertedRow.color, "#2F5D9E");
  assert.equal(state.insertedRow.secondary_color, DEFAULT_WORKSPACE_THEME.secondaryColor);
  assert.equal(state.insertedRow.surface_color, DEFAULT_WORKSPACE_THEME.surfaceColor);
  assert.equal(state.insertedRow.surface_variant_color, DEFAULT_WORKSPACE_THEME.surfaceVariantColor);
  assert.equal(state.insertedRow.invites_enabled, false);
  assert.equal(record.name, "Workspace");
  assert.equal(record.avatarUrl, "");
  assert.equal(record.color, "#2F5D9E");
  assert.equal(record.secondaryColor, DEFAULT_WORKSPACE_THEME.secondaryColor);
  assert.equal(record.surfaceColor, DEFAULT_WORKSPACE_THEME.surfaceColor);
  assert.equal(record.surfaceVariantColor, DEFAULT_WORKSPACE_THEME.surfaceVariantColor);
  assert.equal(record.invitesEnabled, false);
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId updates name/avatar/color columns", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub, {
    defaultInvitesEnabled: true
  });

  const updated = await repository.updateSettingsByWorkspaceId(1, {
    name: "New name",
    avatarUrl: "https://example.com/avatar.png",
    color: "#123abc"
  });

  assert.equal(state.updatePayload.name, "New name");
  assert.equal(state.updatePayload.avatar_url, "https://example.com/avatar.png");
  assert.equal(state.updatePayload.color, "#123ABC");
  assert.equal(updated.name, "New name");
  assert.equal(updated.avatarUrl, "https://example.com/avatar.png");
  assert.equal(updated.color, "#123ABC");
});

test("workspaceSettingsRepository can be constructed without validating app config shape", () => {
  const { knexStub } = createKnexStub();

  const repository = createRepository(knexStub);

  assert.ok(repository);
});
