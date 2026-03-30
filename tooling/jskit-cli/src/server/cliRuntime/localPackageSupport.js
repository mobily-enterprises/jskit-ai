import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";

function resolvePackageDependencySpecifier(packageEntry, { existingValue = "" } = {}) {
  const source = ensureObject(packageEntry?.source);
  const sourceType = String(source.type || packageEntry?.sourceType || "").trim();
  if (sourceType === "app-local-package" || sourceType === "local-package") {
    const packagePath = normalizeRelativePosixPath(String(source.packagePath || packageEntry?.relativeDir || "").trim());
    if (!packagePath) {
      throw createCliError(`Unable to resolve local package path for ${String(packageEntry?.packageId || "unknown package")}.`);
    }
    return toFileDependencySpecifier(packagePath);
  }
  if (sourceType === "npm-installed-package") {
    const normalizedExisting = String(existingValue || "").trim();
    if (normalizedExisting) {
      return normalizedExisting;
    }
  }

  const descriptorVersion = String(packageEntry?.version || "").trim();
  if (descriptorVersion) {
    return normalizeJskitDependencySpecifier(packageEntry?.packageId, descriptorVersion);
  }
  const packageJsonVersion = String(packageEntry?.packageJson?.version || "").trim();
  if (packageJsonVersion) {
    return normalizeJskitDependencySpecifier(packageEntry?.packageId, packageJsonVersion);
  }
  throw createCliError(`Unable to resolve dependency specifier for ${String(packageEntry?.packageId || "unknown package")}.`);
}

function normalizeJskitDependencySpecifier(packageId, dependencySpecifier) {
  const normalizedPackageId = String(packageId || "").trim();
  const normalizedSpecifier = String(dependencySpecifier || "").trim();
  if (!normalizedSpecifier || !normalizedPackageId.startsWith("@jskit-ai/")) {
    return normalizedSpecifier;
  }

  const semverMatch = /^(\d+)\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/.exec(normalizedSpecifier);
  if (!semverMatch) {
    return normalizedSpecifier;
  }

  return `${semverMatch[1]}.x`;
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

function createLocalPackageDescriptorTemplate({ packageId, description }) {
  return `export default Object.freeze({
  packageVersion: 1,
  packageId: "${packageId}",
  version: "0.1.0",
  kind: "runtime",
  description: ${JSON.stringify(String(description || ""))},
  dependsOn: [
    // "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      // "example.feature"
    ],
    requires: [
      // "example.dependency"
    ]
  },
  options: {
    // "example-option": {
    //   required: true,
    //   promptLabel: "Enter option value",
    //   promptHint: "Used by mutations.text interpolation",
    //   defaultValue: "example"
    // }
  },
  runtime: {
    server: {
      providers: [
        // {
        //   entrypoint: "src/server/providers/ExampleServerProvider.js",
        //   export: "ExampleServerProvider"
        // }
      ]
    },
    client: {
      providers: [
        // {
        //   entrypoint: "src/client/providers/ExampleClientProvider.js",
        //   export: "ExampleClientProvider"
        // }
      ]
    }
  },
  metadata: {
    server: {
      routes: [
        // {
        //   method: "GET",
        //   path: "/api/example",
        //   summary: "Describe server route validator"
        // }
      ]
    },
    ui: {
      routes: [
        // {
        //   id: "example.route",
        //   path: "/example",
        //   scope: "global",
        //   name: "example-route",
        //   componentKey: "example-route",
        //   autoRegister: true,
        //   guard: {
        //     policy: "public"
        //   },
        //   purpose: "Describe what this route is for."
        // }
      ],
      elements: [
        // {
        //   key: "example-route",
        //   export: "ExampleView",
        //   entrypoint: "src/client/views/ExampleView.vue",
        //   purpose: "UI element exposed by this package."
        // }
      ],
      overrides: [
        // {
        //   targetId: "some.existing.route",
        //   mode: "replace",
        //   reason: "Explain override intent."
        // }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        // "@example/runtime-dependency": "^1.0.0"
      },
      dev: {
        // "@example/dev-dependency": "^1.0.0"
      }
    },
    packageJson: {
      scripts: {
        // "lint:example": "eslint src/example"
      }
    },
    procfile: {
      // worker: "node ./bin/worker.js"
    },
    vite: {
      proxy: [
        // {
        //   id: "example-socket-proxy",
        //   path: "/socket.io",
        //   changeOrigin: true,
        //   ws: true,
        //   target: "http://localhost:3000",
        //   reason: "Explain why this proxy is needed."
        // }
      ]
    },
    text: [
      // {
      //   op: "upsert-env",
      //   file: ".env",
      //   key: "EXAMPLE_ENV",
      //   value: "\${option:example-option}",
      //   reason: "Explain why this env var is needed.",
      //   category: "runtime-config",
      //   id: "example-env"
      // }
    ],
    files: [
      // {
      //   from: "templates/src/pages/example/index.vue",
      //   to: "src/pages/example/index.vue",
      //   reason: "Explain what is scaffolded.",
      //   category: "example",
      //   id: "example-file"
      // }
    ]
  }
});
`;
}

function createLocalPackageScaffoldFiles({ packageId, packageDescription }) {
  return [
    {
      relativePath: "package.json",
      content: `${JSON.stringify(
        {
          name: packageId,
          version: "0.1.0",
          private: true,
          type: "module",
          exports: {
            ".": "./src/index.js",
            "./client": "./src/client/index.js",
            "./server": "./src/server/index.js",
            "./shared": "./src/shared/index.js"
          }
        },
        null,
        2
      )}\n`
    },
    {
      relativePath: "package.descriptor.mjs",
      content: createLocalPackageDescriptorTemplate({
        packageId,
        description: packageDescription
      })
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
        "- Define runtime providers in `package.descriptor.mjs`.",
        "- Add client/server exports under `src/`.",
        "- Keep package version in sync with descriptor version.",
        ""
      ].join("\n")
    }
  ];
}

function resolveLocalDependencyOrder(initialPackageIds, packageRegistry) {
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const externalDependencies = new Set();

  function visit(packageId, lineage = []) {
    if (visited.has(packageId)) {
      return;
    }
    if (visiting.has(packageId)) {
      const cyclePath = [...lineage, packageId].join(" -> ");
      throw createCliError(`Dependency cycle detected: ${cyclePath}`);
    }

    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package: ${packageId}`);
    }

    visiting.add(packageId);
    for (const dependencyId of ensureArray(packageEntry.descriptor.dependsOn).map((value) => String(value))) {
      if (packageRegistry.has(dependencyId)) {
        visit(dependencyId, [...lineage, packageId]);
      } else {
        externalDependencies.add(dependencyId);
      }
    }
    visiting.delete(packageId);
    visited.add(packageId);
    ordered.push(packageId);
  }

  for (const packageId of initialPackageIds) {
    visit(packageId);
  }

  return {
    ordered,
    externalDependencies: sortStrings([...externalDependencies])
  };
}

export {
  resolvePackageDependencySpecifier,
  normalizeJskitDependencySpecifier,
  normalizePackageNameSegment,
  normalizeScopeName,
  resolveDefaultLocalScopeFromAppName,
  normalizeRelativePosixPath,
  toFileDependencySpecifier,
  resolveLocalPackageId,
  createLocalPackageScaffoldFiles,
  resolveLocalDependencyOrder
};
