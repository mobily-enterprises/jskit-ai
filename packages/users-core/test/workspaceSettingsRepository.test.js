import assert from "node:assert/strict";
import test from "node:test";
import "../test-support/registerDefaultSettingsFields.js";
import { resolveWorkspaceThemePalettes } from "../src/shared/settings.js";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createDefaultWorkspaceSettings() {
  return true;
}

const DEFAULT_WORKSPACE_THEME = resolveWorkspaceThemePalettes({});

function createKnexStub(rowOverrides = {}) {
  const state = {
    insertedRow: null,
    updatePayload: null,
    row: {
      workspace_id: 1,
      light_primary_color: DEFAULT_WORKSPACE_THEME.light.color,
      light_secondary_color: DEFAULT_WORKSPACE_THEME.light.secondaryColor,
      light_surface_color: DEFAULT_WORKSPACE_THEME.light.surfaceColor,
      light_surface_variant_color: DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor,
      dark_primary_color: DEFAULT_WORKSPACE_THEME.dark.color,
      dark_secondary_color: DEFAULT_WORKSPACE_THEME.dark.secondaryColor,
      dark_surface_color: DEFAULT_WORKSPACE_THEME.dark.surfaceColor,
      dark_surface_variant_color: DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor,
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
          light_primary_color: payload.light_primary_color,
          light_secondary_color: payload.light_secondary_color,
          light_surface_color: payload.light_surface_color,
          light_surface_variant_color: payload.light_surface_variant_color,
          dark_primary_color: payload.dark_primary_color,
          dark_secondary_color: payload.dark_secondary_color,
          dark_surface_color: payload.dark_surface_color,
          dark_surface_variant_color: payload.dark_surface_variant_color,
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
            if (Object.hasOwn(payload, "light_primary_color")) {
              state.row.light_primary_color = payload.light_primary_color;
            }
            if (Object.hasOwn(payload, "light_secondary_color")) {
              state.row.light_secondary_color = payload.light_secondary_color;
            }
            if (Object.hasOwn(payload, "light_surface_color")) {
              state.row.light_surface_color = payload.light_surface_color;
            }
            if (Object.hasOwn(payload, "light_surface_variant_color")) {
              state.row.light_surface_variant_color = payload.light_surface_variant_color;
            }
            if (Object.hasOwn(payload, "dark_primary_color")) {
              state.row.dark_primary_color = payload.dark_primary_color;
            }
            if (Object.hasOwn(payload, "dark_secondary_color")) {
              state.row.dark_secondary_color = payload.dark_secondary_color;
            }
            if (Object.hasOwn(payload, "dark_surface_color")) {
              state.row.dark_surface_color = payload.dark_surface_color;
            }
            if (Object.hasOwn(payload, "dark_surface_variant_color")) {
              state.row.dark_surface_variant_color = payload.dark_surface_variant_color;
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
    lightPrimaryColor: DEFAULT_WORKSPACE_THEME.light.color,
    lightSecondaryColor: DEFAULT_WORKSPACE_THEME.light.secondaryColor,
    lightSurfaceColor: DEFAULT_WORKSPACE_THEME.light.surfaceColor,
    lightSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor,
    darkPrimaryColor: DEFAULT_WORKSPACE_THEME.dark.color,
    darkSecondaryColor: DEFAULT_WORKSPACE_THEME.dark.secondaryColor,
    darkSurfaceColor: DEFAULT_WORKSPACE_THEME.dark.surfaceColor,
    darkSurfaceVariantColor: DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor,
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
  assert.equal(state.insertedRow.light_primary_color, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(state.insertedRow.light_secondary_color, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(state.insertedRow.light_surface_color, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(
    state.insertedRow.light_surface_variant_color,
    DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor
  );
  assert.equal(state.insertedRow.dark_primary_color, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(state.insertedRow.dark_secondary_color, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(state.insertedRow.dark_surface_color, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(
    state.insertedRow.dark_surface_variant_color,
    DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor
  );
  assert.equal(state.insertedRow.invites_enabled, false);
  assert.equal(record.lightPrimaryColor, DEFAULT_WORKSPACE_THEME.light.color);
  assert.equal(record.lightSecondaryColor, DEFAULT_WORKSPACE_THEME.light.secondaryColor);
  assert.equal(record.lightSurfaceColor, DEFAULT_WORKSPACE_THEME.light.surfaceColor);
  assert.equal(record.lightSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.light.surfaceVariantColor);
  assert.equal(record.darkPrimaryColor, DEFAULT_WORKSPACE_THEME.dark.color);
  assert.equal(record.darkSecondaryColor, DEFAULT_WORKSPACE_THEME.dark.secondaryColor);
  assert.equal(record.darkSurfaceColor, DEFAULT_WORKSPACE_THEME.dark.surfaceColor);
  assert.equal(record.darkSurfaceVariantColor, DEFAULT_WORKSPACE_THEME.dark.surfaceVariantColor);
  assert.equal(record.invitesEnabled, false);
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId updates workspace settings columns", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub, {
    defaultInvitesEnabled: true
  });

  const updated = await repository.updateSettingsByWorkspaceId(1, {
    lightPrimaryColor: "#123abc"
  });

  assert.equal(state.updatePayload.light_primary_color, "#123ABC");
  assert.equal(updated.lightPrimaryColor, "#123ABC");
});

test("workspaceSettingsRepository can be constructed without validating app config shape", () => {
  const { knexStub } = createKnexStub();

  const repository = createRepository(knexStub);

  assert.ok(repository);
});
