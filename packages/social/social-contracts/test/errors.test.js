import assert from "node:assert/strict";
import test from "node:test";

import { mapSocialError } from "../src/shared/errors.js";

test("mapSocialError prioritizes field errors and known social codes", () => {
  const fieldError = mapSocialError({
    details: {
      fieldErrors: {
        contentText: "Content is required."
      }
    }
  });
  assert.equal(fieldError.message, "Content is required.");

  const codeMapped = mapSocialError({
    details: {
      code: "SOCIAL_ACTOR_NOT_FOUND"
    }
  });
  assert.equal(codeMapped.message, "Profile not found.");

  const fallback = mapSocialError(new Error("boom"), "fallback");
  assert.equal(fallback.message, "boom");
});
