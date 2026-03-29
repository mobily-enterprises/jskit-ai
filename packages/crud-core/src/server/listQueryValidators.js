import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const listSearchQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      q: Type.Optional(Type.String({ minLength: 0 }))
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    if (!Object.hasOwn(source, "q")) {
      return {};
    }

    return {
      q: normalizeText(source.q)
    };
  }
});

const lookupIncludeQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      include: Type.Optional(Type.String({ minLength: 0 }))
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    if (!Object.hasOwn(source, "include")) {
      return {};
    }

    return {
      include: normalizeText(source.include)
    };
  }
});

export {
  listSearchQueryValidator,
  lookupIncludeQueryValidator
};
