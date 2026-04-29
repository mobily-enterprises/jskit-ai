import test from "node:test";
import assert from "node:assert/strict";
import { mergeObjectSchemas } from "./mergeObjectSchemas.js";

test("mergeObjectSchemas merges disjoint object schemas", () => {
  const mergedSchema = mergeObjectSchemas([
    {
      type: "object",
      additionalProperties: false,
      properties: {
        cursor: {
          type: "string",
          minLength: 1
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        search: {
          type: "string",
          minLength: 1
        }
      }
    }
  ]);

  assert.equal(mergedSchema.type, "object");
  assert.equal(mergedSchema.additionalProperties, false);
  assert.equal(typeof mergedSchema.properties.cursor, "object");
  assert.equal(typeof mergedSchema.properties.search, "object");
  assert.deepEqual(mergedSchema.required || [], []);
});

test("mergeObjectSchemas preserves required fields through merged property definitions", () => {
  const mergedSchema = mergeObjectSchemas([
    {
      type: "object",
      additionalProperties: false,
      properties: {
        workspaceSlug: {
          type: "string",
          minLength: 1
        }
      },
      required: ["workspaceSlug"]
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        inviteId: {
          type: "string",
          minLength: 1
        }
      },
      required: ["inviteId"]
    }
  ]);

  assert.deepEqual(mergedSchema.required, ["workspaceSlug", "inviteId"]);
});

test("mergeObjectSchemas rejects duplicate properties with different schema objects", () => {
  assert.throws(
    () =>
      mergeObjectSchemas([
        {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceSlug: {
              type: "string",
              minLength: 1
            }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceSlug: {
              type: "string",
              minLength: 2
            }
          }
        }
      ]),
    /duplicate property "workspaceSlug"/
  );
});
