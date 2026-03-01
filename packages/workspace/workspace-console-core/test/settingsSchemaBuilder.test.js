import assert from "node:assert/strict";
import test from "node:test";
import { buildSchema, buildFieldSchema } from "../src/lib/settingsSchemaBuilder.js";

test("settings schema builder generates patch object schemas", () => {
  const fieldSpecs = {
    theme: {
      type: "enum",
      allowedValues: ["system", "light", "dark"]
    },
    locale: {
      type: "string",
      minLength: 2,
      maxLength: 24,
      pattern: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"
    },
    avatarSize: {
      type: "integer",
      min: 32,
      max: 128
    }
  };

  const schema = buildSchema({ fieldSpecs, mode: "patch" });
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.minProperties, 1);
  assert.deepEqual(schema.properties.theme.enum, ["system", "light", "dark"]);
  assert.equal(schema.properties.avatarSize.minimum, 32);
  assert.equal(schema.properties.avatarSize.maximum, 128);
});

test("settings schema builder supports full-mode required fields and nullable fields", () => {
  const fieldSchema = buildFieldSchema({
    type: "string",
    minLength: 1,
    nullable: true
  });
  assert.deepEqual(fieldSchema.anyOf[1], { type: "null" });

  const schema = buildSchema({
    fieldSpecs: {
      publicChatId: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        nullable: true
      },
      allowGlobalDms: {
        type: "boolean"
      }
    },
    mode: "full",
    requireAtLeastOne: false
  });

  assert.deepEqual(schema.required, ["publicChatId", "allowGlobalDms"]);
  assert.equal(schema.minProperties, undefined);
});
