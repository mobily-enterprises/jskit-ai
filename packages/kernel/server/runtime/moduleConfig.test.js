import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { ModuleConfigError, defineModuleConfig } from "./moduleConfig.js";

test("defineModuleConfig resolves valid config and freezes nested objects", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    schema: createSchema({
      mode: {
        type: "string",
        required: true,
        enum: ["standard", "strict"]
      },
      maxContacts: {
        type: "integer",
        required: true,
        min: 1
      },
      limits: {
        type: "object",
        required: true,
        validator(value) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return "limits must be an object";
          }
          const inviteExpiryHours = Number(value.inviteExpiryHours);
          if (!Number.isInteger(inviteExpiryHours) || inviteExpiryHours < 1 || inviteExpiryHours > 168) {
            return "inviteExpiryHours must be an integer between 1 and 168";
          }
          return undefined;
        }
      }
    }),
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
    schema: createSchema({
      maxContacts: {
        type: "integer",
        required: true,
        min: 1
      }
    })
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

test("defineModuleConfig supports coercion via json-rest-schema casts", () => {
  const moduleConfig = defineModuleConfig({
    moduleId: "contacts",
    coerce: true,
    schema: createSchema({
      maxContacts: { type: "integer", required: true, min: 1 },
      enabled: { type: "boolean", required: true }
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
    schema: createSchema({
      mode: {
        type: "string",
        required: true,
        enum: ["standard", "strict"]
      },
      requireAuditTrail: {
        type: "boolean",
        required: true
      }
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
        schema: createSchema({}),
        load: "not-a-function"
      }),
    /load/
  );
});
