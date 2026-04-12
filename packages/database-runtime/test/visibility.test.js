import assert from "node:assert/strict";
import test from "node:test";
import { applyVisibility, applyVisibilityOwners } from "../src/shared/visibility.js";

function createQueryBuilderStub() {
  return {
    calls: [],
    where(...args) {
      this.calls.push(["where", ...args]);
      return this;
    },
    whereRaw(sql) {
      this.calls.push(["whereRaw", sql]);
      return this;
    }
  };
}

test("applyVisibility appends scope filters to query builders", () => {
  const publicQuery = createQueryBuilderStub();
  applyVisibility(publicQuery, {
    visibility: "public"
  });
  assert.deepEqual(publicQuery.calls, []);

  const workspaceQuery = createQueryBuilderStub();
  applyVisibility(workspaceQuery, {
    visibility: "workspace",
    scopeOwnerId: 12
  });
  assert.deepEqual(workspaceQuery.calls, [["where", "workspace_id", "12"]]);

  const userQuery = createQueryBuilderStub();
  applyVisibility(userQuery, {
    visibility: "user",
    userId: 7
  });
  assert.deepEqual(userQuery.calls, [["where", "user_id", "7"]]);

  const deniedQuery = createQueryBuilderStub();
  applyVisibility(deniedQuery, {
    visibility: "workspace_user",
    scopeOwnerId: 3
  });
  assert.deepEqual(deniedQuery.calls, [["whereRaw", "1 = 0"]]);
});

test("applyVisibilityOwners injects owner columns for write payloads", () => {
  assert.deepEqual(
    applyVisibilityOwners(
      {
        name: "Alice"
      },
      {
        visibility: "public"
      }
    ),
    {
      name: "Alice"
    }
  );

  assert.deepEqual(
    applyVisibilityOwners(
      {
        name: "Alice"
      },
      {
        visibility: "workspace_user",
        scopeOwnerId: 4,
        userId: 9
      }
    ),
    {
      name: "Alice",
      workspace_id: "4",
      user_id: "9"
    }
  );

  assert.throws(
    () =>
      applyVisibilityOwners(
        {
          name: "Alice"
        },
        {
          visibility: "user"
        }
      ),
    /requires userId/
  );
});
