import assert from "node:assert/strict";
import test from "node:test";
import { __testables } from "../src/client/composables/useCrudListNavigationContributor.js";

function element(attributes, rectangle) {
  return {
    attributes,
    getAttribute(name) {
      return this.attributes[name] || "";
    },
    getBoundingClientRect() {
      return rectangle;
    }
  };
}

test("CRUD list navigation state uses the first stable visible item and focused key", () => {
  const hidden = element({ "data-jskit-list-item-key": "hidden" }, { top: 0, bottom: 0, width: 0, height: 0 });
  const above = element({ "data-jskit-list-item-key": "before" }, { top: -25, bottom: 25, width: 100, height: 50 });
  const visible = element({ "data-jskit-list-item-key": "record-42" }, { top: 25, bottom: 75, width: 100, height: 50 });
  const focused = element({ "data-jskit-focus-key": "record-42" }, { top: 25, bottom: 73, width: 90, height: 48 });
  const root = {
    contains: (target) => target === focused,
    querySelectorAll: (selector) => selector === "[data-jskit-list-item-key]" ? [hidden, above, visible] : []
  };
  const documentObject = {
    activeElement: focused,
    defaultView: { innerHeight: 800 },
    querySelectorAll: () => [{
      getAttribute: () => "inventory.products.list.v1",
      ...root
    }]
  };

  assert.deepEqual(
    __testables.captureCrudListNavigationState({
      documentObject,
      contributorId: "inventory.products.list.v1"
    }),
    {
      anchor: { itemKey: "before", offsetY: -25 },
      focusKey: "record-42"
    }
  );
});
