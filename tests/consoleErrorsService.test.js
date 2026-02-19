import assert from "node:assert/strict";
import test from "node:test";

import { createService as createConsoleErrorsService } from "../server/domain/console/services/errors.service.js";

function createFixture({ membership } = {}) {
  const calls = {
    listBrowserErrors: [],
    listServerErrors: [],
    getBrowserErrorById: [],
    getServerErrorById: [],
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
      async getBrowserErrorById(errorId) {
        calls.getBrowserErrorById.push(errorId);
        if (Number(errorId) === 9999) {
          return null;
        }

        return {
          id: Number(errorId),
          message: "browser detail"
        };
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
      async getServerErrorById(errorId) {
        calls.getServerErrorById.push(errorId);
        if (Number(errorId) === 9999) {
          return null;
        }

        return {
          id: Number(errorId),
          message: "server detail"
        };
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

  await assert.rejects(
    () => fixture.service.getBrowserError({ id: 11, email: "mod@example.com" }, 5),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    }
  );

  await assert.rejects(
    () => fixture.service.getServerError({ id: 11, email: "mod@example.com" }, 7),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    }
  );
});

test("console errors service gets browser and server entries by id", async () => {
  const fixture = createFixture({
    membership: {
      userId: 17,
      roleId: "devop",
      status: "active"
    }
  });

  const browser = await fixture.service.getBrowserError({ id: 17, email: "devop@example.com" }, "123");
  assert.equal(browser.entry.id, 123);
  assert.equal(browser.entry.message, "browser detail");

  const server = await fixture.service.getServerError({ id: 17, email: "devop@example.com" }, "321");
  assert.equal(server.entry.id, 321);
  assert.equal(server.entry.message, "server detail");

  assert.deepEqual(fixture.calls.getBrowserErrorById, [123]);
  assert.deepEqual(fixture.calls.getServerErrorById, [321]);
});

test("console errors service returns validation and not-found errors for detail lookups", async () => {
  const fixture = createFixture({
    membership: {
      userId: 18,
      roleId: "devop",
      status: "active"
    }
  });

  await assert.rejects(
    () => fixture.service.getBrowserError({ id: 18, email: "devop@example.com" }, "invalid"),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );

  await assert.rejects(
    () => fixture.service.getServerError({ id: 18, email: "devop@example.com" }, 9999),
    (error) => {
      assert.equal(error.status, 404);
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

test("console errors service simulates different server-side failure types", async () => {
  const fixture = createFixture({
    membership: {
      userId: 2,
      roleId: "devop",
      status: "active"
    }
  });

  await assert.rejects(
    () =>
      fixture.service.simulateServerError({
        user: { id: 2, email: "devop@example.com" },
        payload: { kind: "app_error" }
      }),
    (error) => {
      assert.equal(error.status, 500);
      return true;
    }
  );

  await assert.rejects(
    () =>
      fixture.service.simulateServerError({
        user: { id: 2, email: "devop@example.com" },
        payload: { kind: "type_error" }
      }),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      return true;
    }
  );

  await assert.rejects(
    () =>
      fixture.service.simulateServerError({
        user: { id: 2, email: "devop@example.com" },
        payload: { kind: "range_error" }
      }),
    (error) => {
      assert.equal(error instanceof RangeError, true);
      return true;
    }
  );
});

test("console errors service rejects unsupported server simulation kinds", async () => {
  const fixture = createFixture({
    membership: {
      userId: 3,
      roleId: "devop",
      status: "active"
    }
  });

  await assert.rejects(
    () =>
      fixture.service.simulateServerError({
        user: { id: 3, email: "devop@example.com" },
        payload: { kind: "unknown_kind" }
      }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );
});

test("console errors service emits ingestion observability events for success and failure", async () => {
  const events = [];
  const service = createConsoleErrorsService({
    consoleMembershipsRepository: {
      async findByUserId() {
        return {
          userId: 4,
          roleId: "devop",
          status: "active"
        };
      }
    },
    consoleErrorLogsRepository: {
      async countBrowserErrors() {
        return 0;
      },
      async listBrowserErrors() {
        return [];
      },
      async getBrowserErrorById() {
        return null;
      },
      async countServerErrors() {
        return 0;
      },
      async listServerErrors() {
        return [];
      },
      async getServerErrorById() {
        return null;
      },
      async insertBrowserError() {
        throw new Error("insert failed");
      },
      async insertServerError(payload) {
        return payload;
      }
    },
    observabilityService: {
      recordConsoleErrorIngestion(event) {
        events.push(event);
      }
    }
  });

  await assert.rejects(
    () =>
      service.recordBrowserError({
        payload: {
          message: "boom"
        },
        user: {
          id: 7,
          email: "u@example.com"
        }
      }),
    /insert failed/
  );

  await service.recordServerError({
    message: "server boom",
    statusCode: 500
  });

  assert.deepEqual(events, [
    {
      source: "browser",
      outcome: "failure"
    },
    {
      source: "server",
      outcome: "success"
    }
  ]);
});
