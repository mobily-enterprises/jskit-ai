import test from "node:test";
import assert from "node:assert/strict";
import {
  cursorPaginationQueryValidator
} from "@jskit-ai/kernel/shared/validators";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import {
  listSearchQueryValidator,
  lookupIncludeQueryValidator
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

test("lookupIncludeQueryValidator normalizes include", () => {
  const normalized = lookupIncludeQueryValidator.normalize({
    include: "  vetId,ownerId  "
  });

  assert.deepEqual(normalized, {
    include: "vetId,ownerId"
  });
});

test("lookupIncludeQueryValidator keeps include optional when merged with pagination and search", () => {
  const compiled = compileRouteValidator({
    queryValidator: [cursorPaginationQueryValidator, listSearchQueryValidator, lookupIncludeQueryValidator]
  });

  assert.deepEqual(compiled.schema.querystring.required || [], []);
});
