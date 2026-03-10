import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { mergeObjectSchemas } from "./mergeObjectSchemas.js";

test("mergeObjectSchemas merges disjoint object schemas", () => {
  const mergedSchema = mergeObjectSchemas([
    Type.Object(
      {
        cursor: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        search: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  ]);

  assert.equal(mergedSchema.type, "object");
  assert.equal(mergedSchema.additionalProperties, false);
  assert.equal(typeof mergedSchema.properties.cursor, "object");
  assert.equal(typeof mergedSchema.properties.search, "object");
  assert.deepEqual(mergedSchema.required || [], []);
});

test("mergeObjectSchemas preserves required fields through merged property definitions", () => {
  const mergedSchema = mergeObjectSchemas([
    Type.Object(
      {
        workspaceSlug: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        inviteId: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  ]);

  assert.deepEqual(mergedSchema.required, ["workspaceSlug", "inviteId"]);
});

test("mergeObjectSchemas rejects duplicate properties with different schema objects", () => {
  assert.throws(
    () =>
      mergeObjectSchemas([
        Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
          },
          { additionalProperties: false }
        ),
        Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 2 }))
          },
          { additionalProperties: false }
        )
      ]),
    /duplicate property "workspaceSlug"/
  );
});
