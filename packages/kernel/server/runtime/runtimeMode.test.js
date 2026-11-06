import assert from "node:assert/strict";
import test from "node:test";
import { assertDevelopmentOnlySettings, isProductionEnv } from "./runtimeMode.js";

test("only NODE_ENV=production, in any letter case, is production; anything else, unset included, is development", () => {
  for (const nodeEnv of ["production", "Production", " PRODUCTION "]) {
    assert.equal(isProductionEnv({ NODE_ENV: nodeEnv }), true, nodeEnv);
  }
  for (const nodeEnv of [undefined, "", "development", "test", "staging", "prod"]) {
    assert.equal(isProductionEnv(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }), false, String(nodeEnv));
  }
});

test("a development-only setting stops a production server, saying what to do", () => {
  assert.throws(() => assertDevelopmentOnlySettings({ NODE_ENV: "production", DEV_OUTPUT: "log" }, ["DEV_OUTPUT", "OTHER"]),
    (error) => {
      assert.equal(
        error.message,
        "DEV_OUTPUT is for development only and NODE_ENV is production. Remove it from the production environment."
      );
      return true;
    });
  assert.throws(() => assertDevelopmentOnlySettings({ NODE_ENV: "production", A: "1", B: "2" }, ["A", "B"]),
    { message: /^A, B are for development only and NODE_ENV is production\. Remove them/u });
  assert.doesNotThrow(() => assertDevelopmentOnlySettings({ NODE_ENV: "production", DEV_OUTPUT: " " }, ["DEV_OUTPUT"]));
  assert.doesNotThrow(() => assertDevelopmentOnlySettings({ DEV_OUTPUT: "log" }, ["DEV_OUTPUT"]));
  assert.doesNotThrow(() => assertDevelopmentOnlySettings({ NODE_ENV: "development", DEV_OUTPUT: "log" }, ["DEV_OUTPUT"]));
});
