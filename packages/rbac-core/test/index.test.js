import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  hasPermission,
  listManifestPermissions,
  loadRbacManifest,
  manifestIncludesPermission,
  normalizeManifest,
  resolveRolePermissions
} from "../src/server/index.js";

test("normalizeManifest validates and normalizes role catalog", () => {
  assert.throws(() => normalizeManifest(null), /must be a JSON object/);

  const ownerOnly = normalizeManifest({});
  assert.equal(ownerOnly.roles[OWNER_ROLE_ID].assignable, false);
  assert.deepEqual(ownerOnly.roles[OWNER_ROLE_ID].permissions, ["*"]);
  assert.equal(ownerOnly.defaultInviteRole, null);
  assert.equal(ownerOnly.collaborationEnabled, false);
  assert.deepEqual(ownerOnly.assignableRoleIds, []);

  const normalized = normalizeManifest({
    version: "2",
    defaultInviteRole: "member",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*", "*", "workspace.settings.update"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", " history.read ", "history.write", ""]
      },
      viewer: {
        assignable: false,
        permissions: ["history.read"]
      }
    }
  });

  assert.equal(normalized.version, 2);
  assert.equal(normalized.defaultInviteRole, "member");
  assert.equal(normalized.collaborationEnabled, true);
  assert.deepEqual(normalized.assignableRoleIds, ["member"]);
  assert.deepEqual(normalized.roles.member.permissions, ["history.read", "history.write"]);

  const defaultInviteNotAssignable = normalizeManifest({
    defaultInviteRole: "viewer",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      viewer: {
        assignable: false,
        permissions: ["history.read"]
      }
    }
  });
  assert.equal(defaultInviteNotAssignable.defaultInviteRole, null);
  assert.equal(defaultInviteNotAssignable.collaborationEnabled, false);

  assert.throws(
    () =>
      normalizeManifest({
        roles: {
          owner: {
            assignable: true,
            permissions: ["*"]
          }
        }
      }),
    /roles\.owner must be non-assignable/
  );

  assert.throws(
    () =>
      normalizeManifest({
        roles: {
          owner: {
            assignable: false,
            permissions: ["history.read"]
          }
        }
      }),
    /permissions must include "\*"/
  );
});

test("RBAC permission helpers resolve owner, wildcard, and specific permissions", () => {
  const manifest = normalizeManifest({
    defaultInviteRole: "member",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", "history.write"]
      }
    }
  });

  assert.deepEqual(resolveRolePermissions(manifest, "owner"), ["*"]);
  assert.deepEqual(resolveRolePermissions(manifest, "member"), ["history.read", "history.write"]);
  assert.deepEqual(resolveRolePermissions(manifest, "unknown"), []);

  assert.equal(hasPermission([], ""), true);
  assert.equal(hasPermission(undefined, "history.read"), false);
  assert.equal(hasPermission(["history.read"], "history.read"), true);
  assert.equal(hasPermission(["history.read"], "history.write"), false);
  assert.equal(hasPermission(["*"], "history.write"), true);

  assert.deepEqual(listManifestPermissions(manifest), ["history.read", "history.write"]);
  assert.equal(manifestIncludesPermission(manifest, "history.write"), true);
  assert.equal(manifestIncludesPermission(manifest, "workspace.ai.use"), false);
  assert.equal(manifestIncludesPermission(manifest, "workspace.ai.use", { includeOwner: true }), true);
});

test("createOwnerOnlyManifest and loadRbacManifest handle success and error paths", async () => {
  const ownerOnly = createOwnerOnlyManifest();
  assert.equal(ownerOnly.defaultInviteRole, null);
  assert.equal(ownerOnly.collaborationEnabled, false);
  assert.deepEqual(ownerOnly.assignableRoleIds, []);
  assert.deepEqual(ownerOnly.roles.owner.permissions, ["*"]);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rbac-core-test-"));
  const validManifestPath = path.join(tmpDir, "rbac.json");
  await fs.writeFile(
    validManifestPath,
    JSON.stringify({
      version: 1,
      defaultInviteRole: "member",
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        member: {
          assignable: true,
          permissions: ["history.read"]
        }
      }
    }),
    "utf8"
  );

  const loaded = await loadRbacManifest(validManifestPath);
  assert.equal(loaded.defaultInviteRole, "member");
  assert.equal(loaded.collaborationEnabled, true);

  const invalidManifestPath = path.join(tmpDir, "invalid.json");
  await fs.writeFile(invalidManifestPath, "{not-json", "utf8");
  await assert.rejects(() => loadRbacManifest(invalidManifestPath), /not valid JSON/);
  await assert.rejects(() => loadRbacManifest(path.join(tmpDir, "missing.json")), /Unable to read RBAC manifest/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
