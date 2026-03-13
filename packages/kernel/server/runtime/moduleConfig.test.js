import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ModuleConfigError, defineModuleConfig } from "./moduleConfig.js";

test("defineModuleConfig resolves valid config and freezes nested objects", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    schema: Type.Object(
      {
        mode: Type.Union([Type.Literal("standard"), Type.Literal("strict")]),
        maxContacts: Type.Integer({ minimum: 1 }),
        limits: Type.Object({
          inviteExpiryHours: Type.Integer({ minimum: 1, maximum: 168 })
        })
      },
      { additionalProperties: false }
    ),
    load({ env }) {
      return {
        mode: String(env.CONTACTS_MODE || "standard"),
        maxContacts: Number(env.CONTACTS_MAX || 5000),
        limits: {
          inviteExpiryHours: Number(env.CONTACTS_INVITE_EXPIRY_HOURS || 24)
        }
      };
    }
  });

  const config = moduleConfig.resolve({
    env: {
      CONTACTS_MODE: "strict",
      CONTACTS_MAX: "1000",
      CONTACTS_INVITE_EXPIRY_HOURS: "36"
    }
  });

  assert.equal(config.mode, "strict");
  assert.equal(config.maxContacts, 1000);
  assert.equal(config.limits.inviteExpiryHours, 36);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.limits), true);
});

test("defineModuleConfig reports schema validation issues with module-scoped details", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    schema: Type.Object(
      {
        maxContacts: Type.Integer({ minimum: 1 })
      },
      { additionalProperties: false }
    )
  });

  assert.throws(
    () => moduleConfig.resolve({ raw: { maxContacts: 0, unexpected: true } }),
    (error) => {
      assert.equal(error instanceof ModuleConfigError, true);
      assert.equal(error.moduleId, "contacts");
      assert.equal(error.issues.length >= 1, true);
      assert.equal(String(error.message).includes('module "contacts"'), true);
      return true;
    }
  );
});

test("defineModuleConfig supports coercion via TypeBox Parse", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    coerce: true,
    schema: Type.Object({
      maxContacts: Type.Integer({ minimum: 1 }),
      enabled: Type.Boolean()
    })
  });

  const config = moduleConfig.resolve({
    raw: {
      maxContacts: "42",
      enabled: "true"
    }
  });

  assert.equal(config.maxContacts, 42);
  assert.equal(config.enabled, true);
});

test("defineModuleConfig supports custom cross-field validate hook", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    schema: Type.Object({
      mode: Type.Union([Type.Literal("standard"), Type.Literal("strict")]),
      requireAuditTrail: Type.Boolean()
    }),
    validate(value) {
      if (value.mode === "strict" && value.requireAuditTrail !== true) {
        return [
          {
            path: "requireAuditTrail",
            message: "must be true when mode is strict"
          }
        ];
      }
      return true;
    }
  });

  assert.throws(
    () =>
      moduleConfig.resolve({
        raw: {
          mode: "strict",
          requireAuditTrail: false
        }
      }),
    /requireAuditTrail: must be true when mode is strict/
  );
});

test("defineModuleConfig rejects invalid module config definitions", () => {
  assert.throws(() => defineModuleConfig({}), /moduleId/);
  assert.throws(
    () =>
      defineModuleConfig({
        moduleId: "contacts",
        schema: null
      }),
    /schema/
  );
  assert.throws(
    () =>
      defineModuleConfig({
        moduleId: "contacts",
        schema: Type.Object({}),
        load: "not-a-function"
      }),
    /load/
  );
});
