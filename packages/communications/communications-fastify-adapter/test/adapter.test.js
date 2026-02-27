import assert from "node:assert/strict";
import test from "node:test";
import { createController, buildRoutes } from "../src/shared/index.js";

test("communications fastify adapter controller delegates sendSms", async () => {
  const reply = {
    statusCode: 0,
    body: null,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(body) {
      this.body = body;
    }
  };

  const controller = createController({
    communicationsService: {
      async sendSms() {
        return { sent: true };
      }
    }
  });

  await controller.sendSms({ body: {} }, reply);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.body, { sent: true });
});

test("communications fastify adapter builds sms route", () => {
  const routes = buildRoutes(
    { communications: { sendSms() {} } },
    {
      withStandardErrorResponses: (response) => response,
      missingHandler: () => {}
    }
  );

  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/api/workspace/sms/send");
});
