import assert from "node:assert/strict";
import test from "node:test";
import { mergeValidators } from "./mergeValidators.js";

test("mergeValidators merges schemas and sync normalizers", () => {
  const merged = mergeValidators(
    [
      {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceSlug: {
              type: "string",
              minLength: 1
            }
          }
        },
        normalize(input = {}) {
          return {
            workspaceSlug: String(input.workspaceSlug || "").trim().toLowerCase()
          };
        }
      },
      {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            recordId: {
              anyOf: [
                {
                  type: "integer",
                  minimum: 1
                },
                {
                  type: "string",
                  minLength: 1
                }
              ]
            }
          }
        },
        normalize(input = {}) {
          const parsed = Number(input.recordId);
          return {
            recordId: Number.isInteger(parsed) && parsed > 0 ? parsed : 0
          };
        }
      }
    ],
    {
      context: "route params",
      allowAsyncNormalize: false
    }
  );

  assert.equal(typeof merged.schema, "object");
  assert.equal(typeof merged.normalize, "function");
  assert.deepEqual(merged.normalize({ workspaceSlug: "  ACME  ", recordId: "42" }), {
    workspaceSlug: "acme",
    recordId: 42
  });
});

test("mergeValidators merges async normalizers for action validators", async () => {
  const merged = mergeValidators(
    [
      {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceSlug: {
              type: "string",
              minLength: 1
            }
          }
        },
        async normalize(input = {}) {
          return {
            workspaceSlug: String(input.workspaceSlug || "").trim().toLowerCase()
          };
        }
      },
      {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            invitesEnabled: {
              type: "boolean"
            }
          }
        },
        normalize(input = {}) {
          return {
            invitesEnabled: input.invitesEnabled === true
          };
        }
      }
    ],
    {
      context: "action input"
    }
  );

  assert.equal(typeof merged.schema, "object");
  assert.equal(typeof merged.normalize, "function");
  const normalized = await merged.normalize({
    workspaceSlug: "  ACME  ",
    invitesEnabled: true
  });
  assert.deepEqual(normalized, {
    workspaceSlug: "acme",
    invitesEnabled: true
  });
});

test("mergeValidators enforces schema requirement when requested", () => {
  assert.throws(
    () =>
      mergeValidators(
        [
          {
            normalize() {
              return {};
            }
          }
        ],
        {
          context: "action input",
          requireSchema: true
        }
      ),
    /action input\.schema is required/
  );
});
