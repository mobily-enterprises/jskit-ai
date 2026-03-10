import assert from "node:assert/strict";
import test from "node:test";
import { createRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createDefaultWorkspaceSettings() {
  return true;
}

function createKnexStub(rowOverrides = {}) {
  const state = {
    insertedRow: null,
    updatePayload: null,
    row: {
      workspace_id: 1,
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
  assert.equal(state.insertedRow.invites_enabled, false);
  assert.equal(record.invitesEnabled, false);
});

test("workspaceSettingsRepository can be constructed without validating app config shape", () => {
  const { knexStub } = createKnexStub();

  const repository = createRepository(knexStub);

  assert.ok(repository);
});
