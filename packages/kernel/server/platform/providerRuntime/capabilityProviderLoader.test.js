import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendCapabilityProviders,
  loadCapabilityProviders
} from "./capabilityProviderLoader.js";

async function fixturePackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "jskit-capability-provider-"));
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  return {
    packageRoot,
    packageId: "@fixture/example",
    packageMetadata: {
      runtime: {
        server: {
          providers: [{ entrypoint: "src/provider.js", export: "providers" }]
        }
      }
    }
  };
}

test("capability provider loader imports explicit provider definitions", async () => {
  const packageEntry = await fixturePackage();
  try {
    await writeFile(
      path.join(packageEntry.packageRoot, "src", "provider.js"),
      [
        "export const providers = [{",
        "  id: 'feature.example',",
        "  provides: { example: 'feature.example' },",
        "  setup() { return { example: { ready: true } }; }",
        "}];"
      ].join("\n"),
      "utf8"
    );

    const providers = await loadCapabilityProviders({ packageEntry });
    assert.deepEqual(providers.map((provider) => provider.id), ["feature.example"]);
    assert.deepEqual(providers[0].provides, { example: "feature.example" });
  } finally {
    await rm(packageEntry.packageRoot, { recursive: true, force: true });
  }
});

test("capability provider loader rejects discovery, classes, path escapes, and duplicates", async () => {
  const packageEntry = await fixturePackage();
  try {
    packageEntry.packageMetadata.runtime.server.providers = [{ discover: { dir: "src" } }];
    await assert.rejects(loadCapabilityProviders({ packageEntry }), /explicit entrypoint and export/u);

    packageEntry.packageMetadata.runtime.server.providers = [{ entrypoint: "src/provider.js", export: "Provider" }];
    await writeFile(
      path.join(packageEntry.packageRoot, "src", "provider.js"),
      "export class Provider { static id = 'old.provider'; register() {} }\n",
      "utf8"
    );
    await assert.rejects(loadCapabilityProviders({ packageEntry }), /must contain provider definitions/u);

    packageEntry.packageMetadata.runtime.server.providers = [{ entrypoint: "../outside.js", export: "provider" }];
    await assert.rejects(loadCapabilityProviders({ packageEntry }), /escapes package root/u);

    const providers = [{ id: "feature.example" }];
    assert.throws(
      () => appendCapabilityProviders({
        providers,
        sourceId: "second",
        seenProviderIds: new Map([["feature.example", "first"]]),
        orderedProviders: []
      }),
      /duplicated between first and second/u
    );
  } finally {
    await rm(packageEntry.packageRoot, { recursive: true, force: true });
  }
});
