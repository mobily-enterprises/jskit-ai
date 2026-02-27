import test from "node:test";
import assert from "node:assert/strict";
import { endNdjson, safeStreamError, setNdjsonHeaders, writeNdjson } from "../src/shared/ndjson.js";

test("ndjson helpers set headers, write payloads, and end stream safely", () => {
  const headers = {};
  const writes = [];
  let ended = false;
  const reply = {
    raw: {
      destroyed: false,
      writableEnded: false,
      write(value) {
        writes.push(value);
      },
      end() {
        ended = true;
      }
    },
    header(name, value) {
      headers[name] = value;
    }
  };

  setNdjsonHeaders(reply);
  const wrote = writeNdjson(reply, { type: "meta", messageId: "m_1" });
  assert.equal(wrote, true);
  assert.match(writes[0], /\"type\":\"meta\"/);

  safeStreamError(reply, { type: "error", code: "x", message: "failed", status: 500 });
  assert.equal(ended, true);
  assert.equal(headers["Content-Type"], "application/x-ndjson; charset=utf-8");
});

test("endNdjson is noop for missing raw reply object", () => {
  endNdjson({});
  assert.equal(true, true);
});
