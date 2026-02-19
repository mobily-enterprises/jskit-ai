import assert from "node:assert/strict";
import test from "node:test";

import { createService as createCommunicationsService, __testables } from "../server/modules/communications/service.js";
import { createController as createCommunicationsController } from "../server/modules/communications/controller.js";

test("communications service validates dependencies", () => {
  assert.throws(() => createCommunicationsService({}), /smsService is required/);
});

test("communications service normalizes metadata and delegates to sms service", async () => {
  const calls = [];
  const service = createCommunicationsService({
    smsService: {
      async sendSms(payload) {
        calls.push(payload);
        return {
          sent: false,
          reason: "not_configured",
          provider: "none",
          messageId: null
        };
      }
    }
  });

  const result = await service.sendSms({
    to: "+15551234567",
    text: "hello",
    metadata: "invalid"
  });

  assert.deepEqual(__testables.normalizeMetadata(null), {});
  assert.deepEqual(__testables.normalizeMetadata({ source: "test" }), { source: "test" });
  assert.deepEqual(calls[0], {
    to: "+15551234567",
    text: "hello",
    metadata: {}
  });
  assert.equal(result.reason, "not_configured");
});

test("communications controller delegates sendSms and responds with 200", async () => {
  const serviceCalls = [];
  const controller = createCommunicationsController({
    communicationsService: {
      async sendSms(payload) {
        serviceCalls.push(payload);
        return {
          sent: false,
          reason: "not_implemented",
          provider: "plivo",
          messageId: null
        };
      }
    }
  });

  const reply = {
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

  await controller.sendSms(
    {
      body: {
        to: "+15551234567",
        text: "hello"
      }
    },
    reply
  );

  assert.equal(serviceCalls.length, 1);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.reason, "not_implemented");
});
