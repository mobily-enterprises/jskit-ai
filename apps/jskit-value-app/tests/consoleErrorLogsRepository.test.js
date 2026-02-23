import assert from "node:assert/strict";
import test from "node:test";

import { __testables } from "../server/domain/console/repositories/errorLogs.repository.js";

test("console error logs repository helpers normalize metadata and map rows", () => {
  assert.deepEqual(__testables.parseMetadata(""), {});
  assert.deepEqual(__testables.parseMetadata("not-json"), {});
  assert.deepEqual(__testables.parseMetadata('{"ok":true}'), { ok: true });

  assert.equal(__testables.stringifyMetadata(null), "{}");
  assert.equal(__testables.stringifyMetadata({ a: 1 }), '{"a":1}');

  assert.equal(__testables.normalizeCount({ total: "3" }), 3);
  assert.equal(__testables.normalizeCount({}), 0);

  const browserRow = __testables.mapBrowserErrorRowRequired({
    id: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    occurred_at: null,
    source: "window.error",
    error_name: "TypeError",
    message: "boom",
    stack: "trace",
    url: "https://example.com",
    path: "/w/acme",
    surface: "app",
    user_agent: "ua",
    line_number: 10,
    column_number: 2,
    user_id: 9,
    username: "alex",
    metadata_json: '{"x":1}'
  });

  assert.equal(browserRow.id, 1);
  assert.equal(browserRow.errorName, "TypeError");
  assert.equal(browserRow.lineNumber, 10);
  assert.equal(browserRow.metadata.x, 1);

  const serverRow = __testables.mapServerErrorRowRequired({
    id: 2,
    created_at: "2026-01-01T00:00:00.000Z",
    request_id: "req-1",
    method: "GET",
    path: "/api/demo",
    status_code: 500,
    error_name: "Error",
    message: "failed",
    stack: "trace",
    user_id: null,
    username: "",
    metadata_json: "{}"
  });

  assert.equal(serverRow.id, 2);
  assert.equal(serverRow.statusCode, 500);
  assert.equal(serverRow.requestId, "req-1");
  assert.equal(serverRow.userId, null);
});
