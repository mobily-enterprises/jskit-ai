import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defineProvider } from "../../../shared/capabilities/defineProvider.js";
import {
  assertManifestMatchesProviders,
  manifestCapabilityDrift,
  packageCapabilityDrift,
  validatePackageCapabilities
} from "./packageCatalog.js";

const BOOKS_PROVIDER = defineProvider({
  id: "feature.books",
  requires: {
    actions: "runtime.actions",
    database: "runtime.database",
    events: "runtime.events"
  },
  optional: {
    realtime: "runtime.realtime"
  },
  provides: {
    books: "feature.books"
  },
  setup() {
    return { books: {} };
  }
});

function booksPackage(capabilities) {
  return {
    packageId: "@fixture/books",
    packageMetadata: { capabilities }
  };
}

function recordingLogger() {
  const warnings = [];
  return {
    warnings,
    debug() {},
    info() {},
    warn(fields, message) {
      warnings.push({ fields, message });
    },
    error() {}
  };
}

test("a manifest that names its providers' capabilities passes without warnings", () => {
  const logger = recordingLogger();
  const manifest = {
    provides: ["feature.books", "client.books"],
    requires: ["runtime.database"]
  };

  assertManifestMatchesProviders(booksPackage(manifest), [BOOKS_PROVIDER], { logger });

  assert.deepEqual(logger.warnings, []);
});

test("a manifest that provides a capability its providers do not is refused", () => {
  const manifest = {
    provides: ["feature.books", "feature.authors"],
    requires: ["runtime.database"]
  };

  assert.throws(
    () => assertManifestMatchesProviders(booksPackage(manifest), [BOOKS_PROVIDER], { logger: recordingLogger() }),
    { message: "Package @fixture/books manifest provides [feature.authors, feature.books] but its providers provide [feature.books]." }
  );
});

test("a manifest that misses a capability its providers provide is refused", () => {
  const manifest = {
    provides: [],
    requires: ["runtime.database"]
  };

  assert.throws(
    () => assertManifestMatchesProviders(booksPackage(manifest), [BOOKS_PROVIDER], { logger: recordingLogger() }),
    { message: "Package @fixture/books manifest provides [] but its providers provide [feature.books]." }
  );
});

test("a manifest that misses a capability its providers require is refused", () => {
  const manifest = {
    provides: ["feature.books"],
    requires: []
  };

  assert.throws(
    () => assertManifestMatchesProviders(booksPackage(manifest), [BOOKS_PROVIDER], { logger: recordingLogger() }),
    { message: "Package @fixture/books requires capability runtime.database in its providers but not in its manifest." }
  );
});

test("a manifest requirement no provider has is logged as an install-time requirement", () => {
  const logger = recordingLogger();
  const manifest = {
    provides: ["feature.books"],
    requires: ["runtime.database", "runtime.storage", "client.shell"]
  };

  assertManifestMatchesProviders(booksPackage(manifest), [BOOKS_PROVIDER], { logger });

  assert.deepEqual(logger.warnings, [
    {
      fields: {
        packageId: "@fixture/books",
        capabilityId: "runtime.storage"
      },
      message: "Package manifest requires a capability its providers do not."
    }
  ]);
});

test("a manifest's drift names each capability to add or remove, the kernel's own and client ones aside", () => {
  const manifest = {
    provides: ["feature.authors", "client.books"],
    requires: ["runtime.storage", "runtime.realtime", "client.shell"]
  };

  assert.deepEqual(manifestCapabilityDrift(booksPackage(manifest), [BOOKS_PROVIDER]), {
    manifestProvides: ["feature.authors"],
    provided: ["feature.books"],
    unlistedProvides: ["feature.books"],
    extraProvides: ["feature.authors"],
    // runtime.actions and runtime.events are the kernel's own; runtime.realtime is only optional.
    unlistedRequires: ["runtime.database"],
    extraRequires: ["runtime.realtime", "runtime.storage"]
  });
});

test("a late requirement is one the manifest lists, unless the package provides it itself", () => {
  const auditProvider = defineProvider({
    id: "feature.audit",
    late: {
      evidence: "feature.evidence",
      notes: "feature.notes"
    },
    provides: {
      audit: "feature.audit"
    },
    setup() {
      return { audit: {} };
    }
  });
  const notesProvider = defineProvider({ id: "feature.notes", provides: { notes: "feature.notes" }, setup: () => ({ notes: {} }) });
  const manifest = (requires) => booksPackage({ provides: ["feature.audit", "feature.notes"], requires });

  assert.deepEqual(manifestCapabilityDrift(manifest([]), [auditProvider, notesProvider]).unlistedRequires, ["feature.evidence"]);
  const listed = manifestCapabilityDrift(manifest(["feature.evidence"]), [auditProvider, notesProvider]);
  assert.deepEqual([listed.unlistedRequires, listed.extraRequires], [[], []]);
});

test("a package's drift loads its declared server providers, and is null for a package that declares none", async (t) => {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-manifest-drift-"));
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
  await writeFile(path.join(packageRoot, "src", "server", "BooksFeature.js"), [
    "export const BooksFeature = {",
    "  id: \"feature.books\",",
    "  requires: { database: \"runtime.database\" },",
    "  provides: { books: \"feature.books\" },",
    "  setup() { return { books: {} }; }",
    "};",
    ""
  ].join("\n"));
  const packageEntry = (providers) => ({
    packageId: "@fixture/books",
    packageRoot,
    packageMetadata: {
      capabilities: { provides: ["feature.books"], requires: [] },
      runtime: { server: { providers } }
    }
  });

  const drift = await packageCapabilityDrift(packageEntry([{ entrypoint: "src/server/BooksFeature.js", export: "BooksFeature" }]));

  assert.deepEqual(drift.unlistedRequires, ["runtime.database"]);
  assert.deepEqual([drift.unlistedProvides, drift.extraProvides, drift.extraRequires], [[], [], []]);
  assert.equal(await packageCapabilityDrift(packageEntry([])), null);
});

test("a manifest names its capabilities in any case and spacing the runtime resolves, as its providers do", () => {
  const logger = recordingLogger();
  // The runtime resolves provider ids trimmed and lower-cased, so assistant.personContext is assistant.personcontext.
  const personContext = defineProvider({
    id: "app.person-context",
    requires: { books: "Feature.Books" },
    provides: { personContext: "assistant.personContext" },
    setup() {
      return { personContext: {} };
    }
  });
  const manifest = {
    provides: ["assistant.personContext"],
    requires: [" Feature.Books "]
  };

  assertManifestMatchesProviders(
    { packageId: "@fixture/person-context", packageMetadata: { capabilities: manifest } },
    [personContext],
    { logger }
  );

  assert.deepEqual(logger.warnings, []);
});

test("installed packages provide and require a capability across spellings of its id", () => {
  assert.doesNotThrow(() => validatePackageCapabilities([
    { packageId: "@fixture/person-context", packageMetadata: { capabilities: { provides: ["assistant.personContext"] } } },
    {
      packageId: "@fixture/assistant",
      packageMetadata: { capabilities: { requires: ["assistant.personcontext", "Runtime.Config"] } }
    }
  ], { builtinProvidersByCapability: { "runtime.config": ["application"] } }));

  assert.throws(
    () => validatePackageCapabilities([
      { packageId: "@fixture/auth-one", packageMetadata: { capabilities: { provides: ["Auth.Service"] } } },
      { packageId: "@fixture/auth-two", packageMetadata: { capabilities: { provides: ["auth.service"] } } }
    ]),
    { message: "Capability auth.service is exclusive, but multiple installed packages provide it: @fixture/auth-one, @fixture/auth-two." }
  );
});
