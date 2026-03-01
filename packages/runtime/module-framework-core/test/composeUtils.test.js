import assert from "node:assert/strict";
import test from "node:test";

import { withModuleId } from "../src/lib/composeUtils.js";

test("withModuleId adds moduleId when missing", () => {
  const result = withModuleId({ id: "chat" }, { path: "/chat" });
  assert.deepEqual(result, { path: "/chat", moduleId: "chat" });
});

test("withModuleId preserves existing moduleId and non-object entries", () => {
  assert.deepEqual(withModuleId({ id: "chat" }, { moduleId: "existing", path: "/chat" }), {
    moduleId: "existing",
    path: "/chat"
  });
  assert.equal(withModuleId({ id: "chat" }, null), null);
  assert.equal(withModuleId({ id: "chat" }, "value"), "value");
});
