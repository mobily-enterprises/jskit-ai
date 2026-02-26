import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_TIERS } from "../src/descriptor.js";
import { resolveMounts } from "../src/mountResolver.js";

function moduleDescriptor(overrides = {}) {
  return {
    id: "module-a",
    version: "1.0.0",
    tier: MODULE_TIERS.feature,
    ...overrides
  };
}

test("resolveMounts applies overrides and aliases", () => {
  const result = resolveMounts({
    modules: [
      moduleDescriptor({
        id: "social",
        mounts: [
          {
            key: "social.workspace",
            defaultPath: "/social",
            aliases: ["/community-old"]
          }
        ]
      })
    ],
    overrides: {
      "social.workspace": "/community"
    }
  });

  assert.equal(result.mountsByKey["social.workspace"].path, "/community");
  assert.deepEqual(result.mountsByKey["social.workspace"].aliases, ["/community-old"]);
  assert.equal(result.paths["/community"], "social.workspace");
});

test("resolveMounts strict mode fails on reserved path collisions", () => {
  assert.throws(
    () =>
      resolveMounts({
        mode: "strict",
        modules: [
          moduleDescriptor({
            id: "social",
            mounts: [{ key: "social.workspace", defaultPath: "/social" }]
          })
        ],
        reservedPaths: ["/social"]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_MOUNT_RESERVED_PATH_CONFLICT")
  );
});

test("resolveMounts permissive mode keeps first mount on path conflict", () => {
  const result = resolveMounts({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "social",
        mounts: [{ key: "social.workspace", defaultPath: "/community" }]
      }),
      moduleDescriptor({
        id: "chat",
        mounts: [{ key: "chat.workspace", defaultPath: "/community" }]
      })
    ]
  });

  assert.equal(result.mountsByKey["social.workspace"].path, "/community");
  assert.equal(result.mountsByKey["chat.workspace"], undefined);
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "MODULE_MOUNT_PATH_CONFLICT"));
});

test("resolveMounts permissive mode ignores forbidden override and uses default path", () => {
  const result = resolveMounts({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "chat",
        mounts: [
          {
            key: "chat.workspace",
            defaultPath: "/chat",
            allowOverride: false
          }
        ]
      })
    ],
    overrides: {
      "chat.workspace": "/messages"
    }
  });

  assert.equal(result.mountsByKey["chat.workspace"].path, "/chat");
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "MODULE_MOUNT_OVERRIDE_FORBIDDEN"));
});
