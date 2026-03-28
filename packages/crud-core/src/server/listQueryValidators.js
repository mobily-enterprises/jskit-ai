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

export {
  listSearchQueryValidator
};
