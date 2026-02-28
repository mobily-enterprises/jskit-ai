import assert from "node:assert/strict";
import test from "node:test";

import { mergeClientModuleRegistry } from "../src/shared/appDropins.js";

test("mergeClientModuleRegistry rejects new modules from contributions", () => {
  assert.throws(
    () =>
      mergeClientModuleRegistry({
        baseRegistry: [{ id: "core", client: { flags: { ready: true } } }],
        extensionBundle: {
          entries: [
            {
              id: "extension-a",
              moduleContributions: [
                {
                  moduleId: "new-module",
                  client: { flags: { enabled: true } }
                }
              ]
            }
          ]
        }
      }),
    /must reference an existing module/
  );
});

test("mergeClientModuleRegistry merges contributions into existing modules", () => {
  const registry = mergeClientModuleRegistry({
    baseRegistry: [{ id: "core", client: { flags: { ready: true } } }],
    extensionBundle: {
      entries: [
        {
          id: "extension-b",
          moduleContributions: [
            {
              moduleId: "core",
              client: { flags: { enabled: true } }
            }
          ]
        }
      ]
    }
  });

  assert.deepEqual(registry, [
    {
      id: "core",
      client: {
        flags: {
          ready: true,
          enabled: true
        }
      }
    }
  ]);
});
