import test from "node:test";
import assert from "node:assert/strict";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator
} from "../src/server/listQueryValidators.js";

test("listSearchQueryValidator normalizes q", () => {
  const normalized = listSearchQueryValidator.normalize({
    q: "  ani  "
  });

  assert.deepEqual(normalized, {
    q: "ani"
  });
});

test("listSearchQueryValidator keeps q optional when merged with pagination query validator", () => {
  const compiled = compileRouteValidator({
    queryValidator: [cursorPaginationQueryValidator, listSearchQueryValidator]
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});
