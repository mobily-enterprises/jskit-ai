import assert from "node:assert/strict";
import test from "node:test";
import { leaveApp, reloadAppPage } from "../src/client/navigation/documentNavigation.js";

// A window whose location records each full load: [method, url].
function withWindow(run) {
  const loads = [];
  const previous = globalThis.window;
  globalThis.window = {
    location: {
      origin: "https://app.example.com",
      assign: (url) => loads.push(["assign", url]),
      replace: (url) => loads.push(["replace", url])
    }
  };
  try {
    run(loads);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test("leaveApp opens another site with a push, or in the current entry's place with { replace: true }", () => {
  withWindow((loads) => {
    leaveApp("https://pay.example.org/checkout?session=1");
    leaveApp("https://auth.example.org/consent", { replace: true });
    assert.deepEqual(loads, [
      ["assign", "https://pay.example.org/checkout?session=1"],
      ["replace", "https://auth.example.org/consent"]
    ]);
    assert.throws(() => leaveApp("https://app.example.com/home", { replace: true }), /another site's http\(s\) URL/u);
    assert.throws(() => leaveApp("/home"), /another site's http\(s\) URL/u);
    assert.equal(loads.length, 2);
  });
});

test("reloadAppPage reloads an in-app path in the current entry's place", () => {
  withWindow((loads) => {
    reloadAppPage("/home/projects");
    assert.deepEqual(loads, [["replace", "/home/projects"]]);
    assert.throws(() => reloadAppPage("https://pay.example.org/"), /use leaveApp\(\)/u);
  });
});
