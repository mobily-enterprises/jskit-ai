import assert from "node:assert/strict";
import test from "node:test";

import { createService as createConsoleErrorsService } from "../server/domain/console/services/errors.service.js";

function createFixture({ membership } = {}) {
  const calls = {
    listBrowserErrors: [],
    listServerErrors: [],
    insertBrowserError: [],
    insertServerError: []
  };

  const service = createConsoleErrorsService({
    consoleMembershipsRepository: {
      async findByUserId() {
        return membership || null;
      }
    },
    consoleErrorLogsRepository: {
      async countBrowserErrors() {
        return 25;
      },
      async listBrowserErrors(page, pageSize) {
        calls.listBrowserErrors.push([page, pageSize]);
        return [
          {
            id: 1,
            page,
            pageSize,
            message: "browser"
          }
        ];
      },
      async countServerErrors() {
        return 3;
      },
      async listServerErrors(page, pageSize) {
        calls.listServerErrors.push([page, pageSize]);
        return [
          {
            id: 2,
            page,
            pageSize,
            message: "server"
          }
        ];
      },
      async insertBrowserError(payload) {
        calls.insertBrowserError.push(payload);
        return payload;
      },
      async insertServerError(payload) {
        calls.insertServerError.push(payload);
        return payload;
      }
    }
  });

  return {
    service,
    calls
  };
}

test("console errors service lists browser and server logs with safe pagination", async () => {
  const fixture = createFixture({
    membership: {
      userId: 9,
      roleId: "devop",
      status: "active"
    }
  });

  const browser = await fixture.service.listBrowserErrors(
    { id: 9, email: "devop@example.com" },
    {
      page: 999,
      pageSize: 10
    }
  );

  assert.equal(browser.page, 3);
  assert.equal(browser.pageSize, 10);
  assert.equal(browser.total, 25);
  assert.equal(browser.totalPages, 3);
  assert.equal(browser.entries.length, 1);
  assert.deepEqual(fixture.calls.listBrowserErrors, [[3, 10]]);

  const server = await fixture.service.listServerErrors(
    { id: 9, email: "devop@example.com" },
    {
      page: 4,
      pageSize: 2
    }
  );

  assert.equal(server.page, 2);
  assert.equal(server.total, 3);
  assert.equal(server.totalPages, 2);
  assert.deepEqual(fixture.calls.listServerErrors, [[2, 2]]);
});

test("console errors service enforces role permissions for reads", async () => {
  const fixture = createFixture({
    membership: {
      userId: 11,
      roleId: "moderator",
      status: "active"
    }
  });

  await assert.rejects(
    () => fixture.service.listBrowserErrors({ id: 11, email: "mod@example.com" }, { page: 1, pageSize: 20 }),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    }
  );

  await assert.rejects(
    () => fixture.service.listServerErrors({ id: 11, email: "mod@example.com" }, { page: 1, pageSize: 20 }),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    }
  );
});

test("console errors service records normalized browser and server payloads", async () => {
  const fixture = createFixture({
    membership: {
      userId: 1,
      roleId: "console",
      status: "active"
    }
  });

  await fixture.service.recordBrowserError({
    payload: {
      source: "window.error",
      message: "boom",
      metadata: {
        flag: true,
        nested: {
          value: 1
        }
      }
    },
    user: {
      id: 42,
      email: "owner@example.com"
    }
  });

  await fixture.service.recordServerError({
    requestId: "req-1",
    method: "GET",
    path: "/api/demo",
    statusCode: 502,
    message: "upstream failed",
    userId: 42,
    username: "owner@example.com",
    metadata: {
      surface: "app"
    }
  });

  assert.equal(fixture.calls.insertBrowserError.length, 1);
  assert.equal(fixture.calls.insertBrowserError[0].userId, 42);
  assert.equal(fixture.calls.insertBrowserError[0].message, "boom");
  assert.equal(fixture.calls.insertBrowserError[0].metadata.nested, "[object]");

  assert.equal(fixture.calls.insertServerError.length, 1);
  assert.equal(fixture.calls.insertServerError[0].statusCode, 502);
  assert.equal(fixture.calls.insertServerError[0].path, "/api/demo");
});
