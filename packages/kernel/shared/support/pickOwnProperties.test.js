import assert from "node:assert/strict";
import test from "node:test";
import { pickOwnProperties } from "./pickOwnProperties.js";

test("pickOwnProperties preserves only explicitly present keys", () => {
  const source = {
    theme: "dark",
    avatarUrl: "",
    invitesEnabled: false,
    ignored: "x"
  };

  const patch = pickOwnProperties(source, ["theme", "avatarUrl", "invitesEnabled", "missing"]);

  assert.deepEqual(patch, {
    theme: "dark",
    avatarUrl: "",
    invitesEnabled: false
  });
});

test("pickOwnProperties requires caller-normalized object input", () => {
  assert.throws(() => pickOwnProperties(null, ["theme"]), TypeError);
  assert.throws(() => pickOwnProperties([], ["theme"]), TypeError);
});
