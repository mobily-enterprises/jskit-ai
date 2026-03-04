import assert from "node:assert/strict";
import test from "node:test";

import { BaseController, resolveDomainErrorStatus } from "./controller.js";

function createReplyStub() {
  const state = {
    statusCode: 200,
    payload: undefined,
    headers: {}
  };

  return {
    state,
    code(statusCode) {
      state.statusCode = Number(statusCode);
      return this;
    },
    header(name, value) {
      state.headers[name] = value;
      return this;
    },
    send(payload) {
      state.payload = payload;
      return this;
    }
  };
}

test("resolveDomainErrorStatus prefers explicit status", () => {
  const status = resolveDomainErrorStatus({
    status: 418,
    code: "duplicate_contact"
  });

  assert.equal(status, 418);
});

test("resolveDomainErrorStatus maps known domain codes", () => {
  assert.equal(resolveDomainErrorStatus({ code: "duplicate_contact" }), 409);
  assert.equal(resolveDomainErrorStatus({ code: "domain_validation_failed" }), 422);
  assert.equal(resolveDomainErrorStatus({ code: "not_found" }), 404);
});

test("BaseController.sendActionResult sends success payload and headers", () => {
  const controller = new BaseController();
  const reply = createReplyStub();

  controller.sendActionResult(reply, {
    ok: true,
    data: { ok: true, value: 42 },
    status: 201,
    headers: {
      "x-test": "success"
    }
  });

  assert.equal(reply.state.statusCode, 201);
  assert.deepEqual(reply.state.payload, { ok: true, value: 42 });
  assert.equal(reply.state.headers["x-test"], "success");
});

test("BaseController.sendActionResult maps domain failure", () => {
  const controller = new BaseController();
  const reply = createReplyStub();

  controller.sendActionResult(reply, {
    ok: false,
    code: "duplicate_contact",
    details: ["already exists"]
  });

  assert.equal(reply.state.statusCode, 409);
  assert.deepEqual(reply.state.payload, {
    error: "Request failed.",
    code: "duplicate_contact",
    details: ["already exists"]
  });
});

test("BaseController.fail includes fieldErrors and default details shape", () => {
  const controller = new BaseController();
  const reply = createReplyStub();

  controller.fail(reply, {
    code: "domain_validation_failed",
    message: "Validation failed.",
    fieldErrors: {
      email: "Invalid email."
    }
  });

  assert.equal(reply.state.statusCode, 422);
  assert.deepEqual(reply.state.payload, {
    error: "Validation failed.",
    code: "domain_validation_failed",
    fieldErrors: {
      email: "Invalid email."
    },
    details: {
      fieldErrors: {
        email: "Invalid email."
      }
    }
  });
});

test("BaseController.noContent sends HTTP 204", () => {
  const controller = new BaseController();
  const reply = createReplyStub();

  controller.noContent(reply);

  assert.equal(reply.state.statusCode, 204);
  assert.equal(reply.state.payload, undefined);
});

test("BaseController.sendActionResult rejects invalid result shape", () => {
  const controller = new BaseController();
  const reply = createReplyStub();

  assert.throws(
    () => controller.sendActionResult(reply, { data: { ok: true } }),
    /expects result\.ok to be true or false/
  );
});
