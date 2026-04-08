import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import { toPositiveInteger } from "./support/positiveInteger.js";

const MAX_SYSTEM_PROMPT_CHARS = 12_000;

const assistantConfigRecordSchema = Type.Object(
  {
    targetSurfaceId: Type.String({ minLength: 1, maxLength: 64 }),
    scopeKey: Type.String({ minLength: 1, maxLength: 160 }),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    settings: Type.Object(
      {
        systemPrompt: Type.String({ maxLength: MAX_SYSTEM_PROMPT_CHARS })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);

const assistantConfigPatchSchema = Type.Object(
  {
    systemPrompt: Type.Optional(
      Type.String({
        maxLength: MAX_SYSTEM_PROMPT_CHARS,
        messages: {
          maxLength: `Assistant system prompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters.`,
          default: "Assistant system prompt must be valid text."
        }
      })
    )
  },
  { additionalProperties: false }
);

function normalizeConfigPatch(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "systemPrompt")) {
    normalized.systemPrompt = String(source.systemPrompt || "");
  }

  return normalized;
}

function normalizeConfigRecord(payload = {}) {
  const source = normalizeObjectInput(payload);
  const settings = normalizeObjectInput(source.settings);

  return {
    targetSurfaceId: normalizeText(source.targetSurfaceId).toLowerCase(),
    scopeKey: normalizeText(source.scopeKey),
    workspaceId: toPositiveInteger(source.workspaceId, 0) || null,
    settings: {
      systemPrompt: String(settings.systemPrompt || "")
    }
  };
}

const assistantConfigResource = Object.freeze({
  resource: "assistantConfig",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      outputValidator: Object.freeze({
        schema: assistantConfigRecordSchema,
        normalize: normalizeConfigRecord
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      bodyValidator: Object.freeze({
        schema: assistantConfigPatchSchema,
        normalize: normalizeConfigPatch
      }),
      outputValidator: Object.freeze({
        schema: assistantConfigRecordSchema,
        normalize: normalizeConfigRecord
      })
    })
  })
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConfigResource
};
