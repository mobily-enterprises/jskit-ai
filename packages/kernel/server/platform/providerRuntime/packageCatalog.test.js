import assert from "node:assert/strict";
import test from "node:test";
import { defineProvider } from "../../../shared/capabilities/defineProvider.js";
import { assertManifestMatchesProviders } from "./packageCatalog.js";

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
