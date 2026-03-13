import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { mergeValidators } from "./mergeValidators.js";

test("mergeValidators merges schemas and sync normalizers", () => {
  const merged = mergeValidators(
    [
      {
        schema: Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
          },
          { additionalProperties: false }
        ),
        normalize(input = {}) {
          return {
            workspaceSlug: String(input.workspaceSlug || "").trim().toLowerCase()
          };
        }
      },
      {
        schema: Type.Object(
          {
            recordId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })]))
          },
          { additionalProperties: false }
        ),
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
        schema: Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
          },
          { additionalProperties: false }
        ),
        async normalize(input = {}) {
          return {
            workspaceSlug: String(input.workspaceSlug || "").trim().toLowerCase()
          };
        }
      },
      {
        schema: Type.Object(
          {
            invitesEnabled: Type.Optional(Type.Boolean())
          },
          { additionalProperties: false }
        ),
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
