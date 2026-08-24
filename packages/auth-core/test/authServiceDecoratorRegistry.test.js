import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "../src/server/authExtensions.js";
import { applyAuthServiceDecorators, registerAuthServiceDecorator } from "../src/server/authServiceDecoratorRegistry.js";

test("auth.extensions applies service decorators in declared order", () => {
  const extensions = createAuthExtensions();
  registerAuthServiceDecorator(extensions, {
    decoratorId: "zeta",
    order: 50,
    decorateAuthService(service) {
      return { ...service, trace: [...service.trace, "zeta"] };
    }
  });
  registerAuthServiceDecorator(extensions, {
    decoratorId: "alpha",
    order: 10,
    decorateAuthService(service) {
      return { ...service, trace: [...service.trace, "alpha"] };
    }
  });
  assert.deepEqual(applyAuthServiceDecorators(extensions, { trace: [] }).trace, ["alpha", "zeta"]);
  assert.deepEqual(extensions.diagnostics().serviceDecoratorIds, ["alpha", "zeta"]);
});

test("auth.extensions rejects invalid results and late registration", () => {
  const extensions = createAuthExtensions();
  registerAuthServiceDecorator(extensions, {
    decoratorId: "invalid",
    decorateAuthService() {
      return null;
    }
  });
  assert.throws(() => applyAuthServiceDecorators(extensions, {}), /must return an auth service object/);
  assert.throws(() => registerAuthServiceDecorator(extensions, {
    decoratorId: "late",
    decorateAuthService(service) { return service; }
  }), /registration is closed/);
});
