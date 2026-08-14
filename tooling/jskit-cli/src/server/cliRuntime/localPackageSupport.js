import { createCliError } from "../shared/cliError.js";
import { ensureObject } from "../shared/collectionUtils.js";

function resolvePackageDependencySpecifier(packageEntry) {
  const source = ensureObject(packageEntry?.source);
  const sourceType = String(source.type || packageEntry?.sourceType || "").trim();
  if (sourceType === "app-local-package" || sourceType === "local-package") {
    const packagePath = normalizeRelativePosixPath(String(source.packagePath || packageEntry?.relativeDir || "").trim());
    if (!packagePath) {
      throw createCliError(`Unable to resolve local package path for ${String(packageEntry?.packageId || "unknown package")}.`);
    }
    return toFileDependencySpecifier(packagePath);
  }
  const publishedVersion = String(
    packageEntry?.version || packageEntry?.packageJson?.version || ""
  ).trim();
  if (publishedVersion) {
    return normalizeJskitDependencySpecifier(packageEntry?.packageId, publishedVersion);
  }
  throw createCliError(`Unable to resolve dependency specifier for ${String(packageEntry?.packageId || "unknown package")}.`);
}

function normalizeJskitDependencySpecifier(packageId, dependencySpecifier) {
  const normalizedPackageId = String(packageId || "").trim();
  const normalizedSpecifier = String(dependencySpecifier || "").trim();
  if (!normalizedSpecifier || !normalizedPackageId.startsWith("@jskit-ai/")) {
    return normalizedSpecifier;
  }
  return normalizedSpecifier;
}

function normalizePackageNameSegment(rawValue, { label = "package name" } = {}) {
  const lowered = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!lowered) {
    throw createCliError(`Invalid ${label}. Use letters, numbers, dash, underscore, or dot.`);
  }
  return lowered;
}

function normalizeScopeName(rawScope) {
  const normalized = String(rawScope || "").trim().replace(/^@+/, "");
  return normalizePackageNameSegment(normalized, { label: "scope" });
}

function resolveDefaultLocalScopeFromAppName(appPackageName) {
  const appName = String(appPackageName || "").trim();
  if (!appName) {
    return "app";
  }

  const unscoped = appName.startsWith("@")
    ? appName.slice(appName.indexOf("/") + 1)
    : appName;
  return normalizeScopeName(unscoped || "app");
}

function normalizeRelativePosixPath(pathValue) {
  return String(pathValue || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function toFileDependencySpecifier(relativePath) {
  const normalized = normalizeRelativePosixPath(relativePath);
  if (!normalized) {
    throw createCliError("Cannot create file: dependency specifier from empty relative path.");
  }
  return `file:${normalized}`;
}

function resolveLocalPackageId({ rawName, appPackageName, inlineOptions }) {
  const explicitPackageId = String(inlineOptions["package-id"] || "").trim();
  if (explicitPackageId) {
    const scopedPattern = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
    if (!scopedPattern.test(explicitPackageId)) {
      throw createCliError(
        `Invalid --package-id ${explicitPackageId}. Expected format: @scope/name (lowercase alphanumeric, ., _, -).`
      );
    }
    const packageName = explicitPackageId.slice(explicitPackageId.indexOf("/") + 1);
    return {
      packageId: explicitPackageId,
      packageDirName: normalizePackageNameSegment(packageName)
    };
  }

  const packageDirName = normalizePackageNameSegment(rawName);
  const scopeName = String(inlineOptions.scope || "").trim()
    ? normalizeScopeName(inlineOptions.scope)
    : resolveDefaultLocalScopeFromAppName(appPackageName);
  return {
    packageId: `@${scopeName}/${packageDirName}`,
    packageDirName
  };
}

function createLocalPackageMetadata() {
  return {
    kind: "runtime",
    capabilities: {
      provides: [],
      requires: []
    },
    runtime: {
      server: { providers: [] },
      client: { providers: [] }
    },
    mutations: {
      dependencies: {
        runtime: {},
        dev: {}
      },
      files: []
    }
  };
}

function createLocalPackageScaffoldFiles({ packageId, packageDescription }) {
  return [
    {
      relativePath: "package.json",
      content: `${JSON.stringify(
        {
          name: packageId,
          version: "0.1.0",
          description: String(packageDescription || ""),
          private: true,
          type: "module",
          exports: {
            ".": "./src/index.js",
            "./client": "./src/client/index.js",
            "./server": "./src/server/index.js",
            "./shared": "./src/shared/index.js"
          },
          jskit: createLocalPackageMetadata()
        },
        null,
        2
      )}\n`
    },
    {
      relativePath: "src/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "src/server/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "src/client/index.js",
      content: [
        "const routeComponents = Object.freeze({});",
        "",
        "async function bootClient({ logger } = {}) {",
        "  if (logger && typeof logger.debug === \"function\") {",
        `    logger.debug({ packageId: ${JSON.stringify(packageId)} }, "bootClient executed.");`,
        "  }",
        "}",
        "",
        "export { routeComponents, bootClient };",
        ""
      ].join("\n")
    },
    {
      relativePath: "src/shared/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "README.md",
      content: [
        `# ${packageId}`,
        "",
        "App-local JSKIT module scaffold.",
        "",
        "## Next Steps",
        "",
        "- Define JSKIT runtime providers in the `jskit` object in `package.json`.",
        "- Add client/server exports under `src/`.",
        ""
      ].join("\n")
    }
  ];
}

export {
  resolvePackageDependencySpecifier,
  normalizePackageNameSegment,
  normalizeScopeName,
  resolveDefaultLocalScopeFromAppName,
  normalizeRelativePosixPath,
  toFileDependencySpecifier,
  resolveLocalPackageId,
  createLocalPackageScaffoldFiles
};
