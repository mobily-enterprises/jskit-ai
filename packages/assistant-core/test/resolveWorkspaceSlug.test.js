import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceSlug } from "../src/server/lib/resolveWorkspaceSlug.js";

test("resolveWorkspaceSlug follows fallback priority", () => {
  const slug = resolveWorkspaceSlug(
    {
      workspace: {
        slug: "workspace-primary"
      },
      requestMeta: {
        resolvedWorkspaceContext: {
          workspace: {
            slug: "workspace-resolved"
          }
        },
        request: {
          input: {
            params: {
              workspaceSlug: "workspace-request"
            }
          }
        }
      }
    },
    {
      workspaceSlug: "workspace-input"
    }
  );

  assert.equal(slug, "workspace-primary");
});

test("resolveWorkspaceSlug resolves from requestMeta resolved workspace", () => {
  const slug = resolveWorkspaceSlug({
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          slug: "workspace-resolved"
        }
      }
    }
  });

  assert.equal(slug, "workspace-resolved");
});

test("resolveWorkspaceSlug resolves from action input before request params", () => {
  const slug = resolveWorkspaceSlug(
    {
      requestMeta: {
        request: {
          input: {
            params: {
              workspaceSlug: "workspace-request"
            }
          }
        }
      }
    },
    {
      workspaceSlug: "workspace-input"
    }
  );

  assert.equal(slug, "workspace-input");
});

test("resolveWorkspaceSlug resolves from request params when needed", () => {
  const slug = resolveWorkspaceSlug({
    requestMeta: {
      request: {
        input: {
          params: {
            workspaceSlug: "workspace-request"
          }
        }
      }
    }
  });

  assert.equal(slug, "workspace-request");
});
