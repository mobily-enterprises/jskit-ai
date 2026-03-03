import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../src/server/controllers/AuthController.js";

function createReplyStub() {
  return {
    statusCode: null,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    }
  };
}

test("logout clears local cookies and returns ok when auth service is unavailable", async () => {
  let clearSessionCalls = 0;

  const controller = new AuthController({
    service: {
      async logout() {
        throw new Error("upstream unavailable");
      },
      clearSessionCookies() {
        clearSessionCalls += 1;
      }
    }
  });

  const logs = [];
  const request = {
    log: {
      warn(payload, message) {
        logs.push({ payload, message });
      }
    }
  };
  const reply = createReplyStub();

  await controller.logout(request, reply);

  assert.equal(clearSessionCalls, 1);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { ok: true });
  assert.equal(logs.length, 1);
});
