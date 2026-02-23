import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingPolicyService, BILLING_MANAGE_PERMISSION } from "../server/modules/billing/policy.service.js";

function createPolicyService({ findBillableEntityById, listByUserId, resolvePermissions } = {}) {
  return createBillingPolicyService({
    workspacesRepository: {
      async listByUserId(userId) {
        if (typeof listByUserId === "function") {
          return listByUserId(userId);
        }

        return [
          {
            id: 10,
            slug: "alpha",
            name: "Alpha",
            ownerUserId: 1,
            roleId: "admin"
          }
        ];
      }
    },
    billingRepository: {
      async ensureBillableEntity({ workspaceId, ownerUserId }) {
        return {
          id: 200,
          entityType: "workspace",
          entityRef: null,
          workspaceId,
          ownerUserId,
          status: "active"
        };
      },
      async ensureBillableEntityByScope(payload) {
        const entityType = String(payload?.entityType || "").toLowerCase();
        if (entityType === "user") {
          return {
            id: 201,
            entityType: "user",
            entityRef: String(payload?.entityRef || ""),
            workspaceId: null,
            ownerUserId: Number(payload?.ownerUserId || 0),
            status: "active"
          };
        }

        return {
          id: 200,
          entityType: "workspace",
          entityRef: null,
          workspaceId: Number(payload?.workspaceId || 0),
          ownerUserId: Number(payload?.ownerUserId || 0),
          status: "active"
        };
      },
      async findBillableEntityById(id) {
        if (typeof findBillableEntityById === "function") {
          return findBillableEntityById(id);
        }

        return {
          id,
          entityType: "workspace",
          entityRef: null,
          workspaceId: 10,
          ownerUserId: 1,
          status: "active"
        };
      }
    },
    resolvePermissions: resolvePermissions || ((roleId) => (roleId === "admin" ? [BILLING_MANAGE_PERMISSION] : []))
  });
}

test("billing policy service resolves explicitly selected workspace billable entity", async () => {
  const service = createPolicyService({
    findBillableEntityById(id) {
      assert.equal(id, 77);
      return {
        id: 77,
        entityType: "workspace",
        entityRef: null,
        workspaceId: 10,
        ownerUserId: 1,
        status: "active"
      };
    }
  });

  const resolved = await service.resolveBillableEntityForReadRequest({
    request: {
      headers: {
        "x-billable-entity-id": "77"
      }
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.billableEntity.id, 77);
  assert.equal(resolved.workspace.id, 10);
  assert.ok(Array.isArray(resolved.permissions));
});

test("billing policy service allows owner-scoped user billable entity writes", async () => {
  const service = createPolicyService({
    findBillableEntityById(id) {
      assert.equal(id, 88);
      return {
        id: 88,
        entityType: "user",
        entityRef: "user:1",
        workspaceId: null,
        ownerUserId: 1,
        status: "active"
      };
    }
  });

  const resolved = await service.resolveBillableEntityForWriteRequest({
    request: {
      headers: {
        "x-billable-entity-id": "88"
      }
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.billableEntity.id, 88);
  assert.equal(resolved.workspace, null);
  assert.deepEqual(resolved.permissions, []);
});

test("billing policy service rejects non-owner user billable entity access", async () => {
  const service = createPolicyService({
    findBillableEntityById() {
      return {
        id: 99,
        entityType: "user",
        entityRef: "user:5",
        workspaceId: null,
        ownerUserId: 5,
        status: "active"
      };
    }
  });

  await assert.rejects(
    () =>
      service.resolveBillableEntityForReadRequest({
        request: {
          headers: {
            "x-billable-entity-id": "99"
          }
        },
        user: {
          id: 1
        }
      }),
    (error) => Number(error?.statusCode) === 403 && String(error?.code || "") === "BILLING_ENTITY_FORBIDDEN"
  );
});

test("billing policy service prefers header billable entity selector over params and query", async () => {
  const seenEntityIds = [];
  const service = createPolicyService({
    findBillableEntityById(id) {
      seenEntityIds.push(id);
      return {
        id,
        entityType: "workspace",
        entityRef: null,
        workspaceId: 10,
        ownerUserId: 1,
        status: "active"
      };
    }
  });

  const resolved = await service.resolveBillableEntityForReadRequest({
    request: {
      headers: {
        "x-billable-entity-id": "501"
      },
      params: {
        billableEntityId: "777"
      },
      query: {
        billableEntityId: "888"
      }
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.billableEntity.id, 501);
  assert.deepEqual(seenEntityIds, [501]);
});

test("billing policy service defaults to owner-scoped user entity for writes when no selector is provided", async () => {
  const service = createPolicyService({
    listByUserId() {
      return [
        {
          id: 10,
          slug: "alpha",
          name: "Alpha",
          ownerUserId: 1,
          roleId: "admin"
        },
        {
          id: 11,
          slug: "beta",
          name: "Beta",
          ownerUserId: 1,
          roleId: "admin"
        }
      ];
    }
  });

  const resolved = await service.resolveBillableEntityForWriteRequest({
    request: {
      headers: {}
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.workspace, null);
  assert.equal(resolved.billableEntity.entityType, "user");
  assert.equal(resolved.billableEntity.entityRef, "user:1");
  assert.equal(resolved.billableEntity.ownerUserId, 1);
  assert.deepEqual(resolved.permissions, []);
});

test("billing policy service enforces workspace billing manage permission for selected workspace entity writes", async () => {
  const service = createPolicyService({
    listByUserId() {
      return [
        {
          id: 10,
          slug: "alpha",
          name: "Alpha",
          ownerUserId: 1,
          roleId: "member"
        }
      ];
    },
    resolvePermissions() {
      return [];
    },
    findBillableEntityById() {
      return {
        id: 321,
        entityType: "workspace",
        entityRef: null,
        workspaceId: 10,
        ownerUserId: 1,
        status: "active"
      };
    }
  });

  await assert.rejects(
    () =>
      service.resolveBillableEntityForWriteRequest({
        request: {
          headers: {
            "x-billable-entity-id": "321"
          }
        },
        user: {
          id: 1
        }
      }),
    (error) => Number(error?.statusCode) === 403 && String(error?.code || "") === "BILLING_PERMISSION_REQUIRED"
  );
});

test("billing policy service currently rejects organization and external billable entities", async () => {
  for (const entityType of ["organization", "external"]) {
    const service = createPolicyService({
      findBillableEntityById() {
        return {
          id: 700,
          entityType,
          entityRef: `${entityType}:abc`,
          workspaceId: null,
          ownerUserId: 1,
          status: "active"
        };
      }
    });

    await assert.rejects(
      () =>
        service.resolveBillableEntityForReadRequest({
          request: {
            headers: {
              "x-billable-entity-id": "700"
            }
          },
          user: {
            id: 1
          }
        }),
      (error) => Number(error?.statusCode) === 403 && String(error?.code || "") === "BILLING_ENTITY_FORBIDDEN"
    );
  }
});

test("billing policy service defaults to owner-scoped user entity for reads when no selector is provided", async () => {
  const service = createPolicyService({
    listByUserId() {
      return [];
    }
  });

  const resolved = await service.resolveBillableEntityForReadRequest({
    request: {
      headers: {}
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.workspace, null);
  assert.equal(resolved.billableEntity.entityType, "user");
  assert.equal(resolved.billableEntity.entityRef, "user:1");
  assert.equal(resolved.billableEntity.ownerUserId, 1);
  assert.deepEqual(resolved.permissions, []);
});

test("billing policy service still requires explicit workspace selector to access workspace-scoped billing", async () => {
  const service = createPolicyService({
    listByUserId() {
      return [
        {
          id: 10,
          slug: "alpha",
          name: "Alpha",
          ownerUserId: 1,
          roleId: "admin"
        },
        {
          id: 11,
          slug: "beta",
          name: "Beta",
          ownerUserId: 1,
          roleId: "admin"
        }
      ];
    }
  });

  const resolved = await service.resolveBillableEntityForWriteRequest({
    request: {
      headers: {
        "x-workspace-slug": "beta"
      }
    },
    user: {
      id: 1
    }
  });

  assert.equal(resolved.workspace.id, 11);
  assert.equal(resolved.billableEntity.entityType, "workspace");
  assert.equal(resolved.billableEntity.workspaceId, 11);
});
