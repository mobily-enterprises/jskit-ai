import assert from "node:assert/strict";
import test from "node:test";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createKnexStub(rowOverrides = {}) {
  const state = {
    updatePayload: null,
    row: {
      workspace_id: 1,
      invites_enabled: 1,
      features_json: JSON.stringify({
        featureFlag: true,
        surfaceAccess: {
          app: {
            denyEmails: ["old@example.com"],
            denyUserIds: [7]
          }
        }
      }),
      created_at: "2026-03-09 00:26:35.710",
      updated_at: "2026-03-09 00:26:35.710",
      ...rowOverrides
    }
  };

  function tableBuilder(tableName) {
    assert.equal(tableName, "workspace_settings");

    return {
      where(criteria) {
        assert.equal(typeof criteria, "object");

        return {
          first() {
            return Promise.resolve({ ...state.row });
          },
          update(payload) {
            state.updatePayload = payload;
            if (Object.hasOwn(payload, "invites_enabled")) {
              state.row.invites_enabled = payload.invites_enabled;
            }
            if (Object.hasOwn(payload, "features_json")) {
              state.row.features_json = payload.features_json;
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

test("workspaceSettingsRepository.findByWorkspaceId normalizes missing app deny-list arrays", async () => {
  const { knexStub } = createKnexStub({
    features_json: JSON.stringify({
      featureFlag: true
    })
  });
  const repository = createRepository(knexStub);

  const record = await repository.findByWorkspaceId(1);

  assert.deepEqual(record.features, {
    featureFlag: true,
    surfaceAccess: {
      app: {
        denyEmails: [],
        denyUserIds: []
      }
    }
  });
});

test("workspaceSettingsRepository.updateSettingsByWorkspaceId merges app deny-list updates into persisted features", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub);

  const updated = await repository.updateSettingsByWorkspaceId(1, {
    invitesEnabled: false,
    appDenyEmails: ["new@example.com"],
    appDenyUserIds: [3, 4]
  });

  assert.equal(state.updatePayload.invites_enabled, false);
  assert.deepEqual(JSON.parse(state.updatePayload.features_json), {
    featureFlag: true,
    surfaceAccess: {
      app: {
        denyEmails: ["new@example.com"],
        denyUserIds: [3, 4]
      }
    }
  });
  assert.equal(updated.invitesEnabled, false);
  assert.deepEqual(updated.features.surfaceAccess.app.denyEmails, ["new@example.com"]);
  assert.deepEqual(updated.features.surfaceAccess.app.denyUserIds, [3, 4]);
});
