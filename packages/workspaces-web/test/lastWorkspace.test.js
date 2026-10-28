import assert from "node:assert/strict";
import test from "node:test";
import {
  readLastWorkspaceSlug,
  resolveWorkspaceLandingSlug,
  writeLastWorkspaceSlug
} from "../src/client/lib/lastWorkspace.js";

function createStorageStub() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values
  };
}

const workspaces = [
  { id: "1", slug: "home", name: "Home" },
  { id: "2", slug: "acme", name: "Acme" }
];

test("last workspace is remembered per user", () => {
  const storage = createStorageStub();
  writeLastWorkspaceSlug("7", "acme", { storage });
  writeLastWorkspaceSlug("8", "home", { storage });
  writeLastWorkspaceSlug("", "ignored", { storage });

  assert.equal(readLastWorkspaceSlug("7", { storage }), "acme");
  assert.equal(readLastWorkspaceSlug("8", { storage }), "home");
  assert.equal(readLastWorkspaceSlug("9", { storage }), "");
  assert.equal(storage.values.size, 2);
});

test("last workspace memory tolerates unavailable storage", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    }
  };

  assert.doesNotThrow(() => writeLastWorkspaceSlug("7", "acme", { storage }));
  assert.equal(readLastWorkspaceSlug("7", { storage }), "");
  assert.equal(readLastWorkspaceSlug("7", { storage: null }), "");
});

test("workspace landing opens the last used workspace, then the only one", () => {
  assert.equal(resolveWorkspaceLandingSlug({ workspaces, lastWorkspaceSlug: "acme" }), "acme");
  assert.equal(resolveWorkspaceLandingSlug({ workspaces, lastWorkspaceSlug: "gone" }), "");
  assert.equal(resolveWorkspaceLandingSlug({ workspaces }), "");
  assert.equal(resolveWorkspaceLandingSlug({ workspaces: [workspaces[1]], lastWorkspaceSlug: "gone" }), "acme");
  assert.equal(resolveWorkspaceLandingSlug({ workspaces: [] }), "");
});

test("workspace landing stays on the list for pending invitations or an inaccessible last workspace", () => {
  assert.equal(
    resolveWorkspaceLandingSlug({ workspaces, pendingInvites: [{ token: "a" }], lastWorkspaceSlug: "acme" }),
    ""
  );
  assert.equal(
    resolveWorkspaceLandingSlug({
      workspaces: [workspaces[0], { ...workspaces[1], isAccessible: false }],
      lastWorkspaceSlug: "acme"
    }),
    ""
  );
});
