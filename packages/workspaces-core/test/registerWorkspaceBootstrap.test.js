import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceBootstrap } from "../src/server/registerWorkspaceBootstrap.js";

function createAppDouble() {
  const singletons = new Map();
  const tags = [];

  return {
    singletons,
    tags,
    app: {
      singleton(token, factory) {
        singletons.set(token, factory);
        return this;
      },
      tag(token, name) {
        tags.push({ token, name });
        return this;
      }
    }
  };
}

test("registerWorkspaceBootstrap resolves the canonical pending invitations service token when enabled", () => {
  const { app, singletons, tags } = createAppDouble();
  registerWorkspaceBootstrap(app);

  assert.deepEqual(tags, [
    {
      token: "workspaces.core.bootstrap.payloadContributor",
      name: "jskit.runtime.bootstrap.payloadContributors"
    }
  ]);

  const factory = singletons.get("workspaces.core.bootstrap.payloadContributor");
  assert.equal(typeof factory, "function");

  const resolvedTokens = [];
  factory({
    make(token) {
      resolvedTokens.push(token);

      if (token === "workspaces.invitations.enabled") {
        return true;
      }
      if (token === "workspaces.service") {
        return {
          listWorkspacesForUser() {},
          resolveWorkspaceContextForUserBySlug() {}
        };
      }
      if (token === "workspaces.pending-invitations.service") {
        return {
          listPendingInvitesForUser() {}
        };
      }
      if (token === "usersRepository") {
        return {
          findById() {}
        };
      }
      if (token === "config") {
        return {
          tenancyMode: "workspaces"
        };
      }
      if (token === "workspaces.tenancy.profile") {
        return {
          mode: "workspaces",
          workspace: {
            enabled: true,
            autoProvision: false,
            allowSelfCreate: false,
            slugPolicy: "user_selected"
          }
        };
      }

      throw new Error(`Unexpected token: ${token}`);
    }
  });

  assert.ok(resolvedTokens.includes("workspaces.pending-invitations.service"));
  assert.ok(!resolvedTokens.includes("users.workspace.pending-invitations.service"));
});
