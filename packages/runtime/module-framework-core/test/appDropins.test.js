import assert from "node:assert/strict";
import test from "node:test";

import { mergeClientModuleRegistry, __testables } from "../src/lib/appDropins.js";

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

test("resolveServerDropinChannels includes defaults and additional channels", () => {
  const channels = __testables.resolveServerDropinChannels({
    extensionDirectory: "extensions.d",
    settingsDirectory: "settings.extensions.d",
    workersDirectory: "workers.extensions.d",
    additionalChannels: [
      {
        key: "custom",
        directoryName: "custom.extensions.d",
        kind: "server"
      }
    ]
  });

  assert.deepEqual(channels, [
    { key: "server", directoryName: "extensions.d", kind: "server" },
    { key: "settings", directoryName: "settings.extensions.d", kind: "settings" },
    { key: "workers", directoryName: "workers.extensions.d", kind: "workers" },
    { key: "custom", directoryName: "custom.extensions.d", kind: "server" }
  ]);
});

test("resolveServerDropinChannels rejects duplicate channel keys", () => {
  assert.throws(
    () =>
      __testables.resolveServerDropinChannels({
        extensionDirectory: "extensions.d",
        settingsDirectory: "settings.extensions.d",
        workersDirectory: "workers.extensions.d",
        additionalChannels: [
          {
            key: "server",
            directoryName: "another.extensions.d",
            kind: "server"
          }
        ]
      }),
    /duplicated/
  );
});
