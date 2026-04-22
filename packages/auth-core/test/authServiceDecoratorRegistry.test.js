import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import {
  AUTH_SERVICE_DECORATOR_TAG,
  registerAuthServiceDecorator,
  resolveAuthServiceDecorators
} from "../src/server/authServiceDecoratorRegistry.js";

test("auth service decorator registry resolves decorators in order", () => {
  const app = createApplication();

  registerAuthServiceDecorator(app, "test.auth.decorator.zeta", () => ({
    decoratorId: "zeta",
    order: 50,
    decorateAuthService(service) {
      return {
        ...service,
        trace: [...service.trace, "zeta"]
      };
    }
  }));

  registerAuthServiceDecorator(app, "test.auth.decorator.alpha", () => ({
    decoratorId: "alpha",
    order: 10,
    decorateAuthService(service) {
      return {
        ...service,
        trace: [...service.trace, "alpha"]
      };
    }
  }));

  const decorators = resolveAuthServiceDecorators(app);
  assert.equal(decorators.length, 2);
  assert.deepEqual(
    decorators.map((entry) => entry.decoratorId),
    ["alpha", "zeta"]
  );

  const decorated = decorators.reduce(
    (service, decorator) => decorator.decorateAuthService(service),
    { trace: [] }
  );
  assert.deepEqual(decorated.trace, ["alpha", "zeta"]);
});

test("auth service decorator registry exports canonical tag", () => {
  assert.equal(AUTH_SERVICE_DECORATOR_TAG, "jskit.auth.service.decorators");
});
