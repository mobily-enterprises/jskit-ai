import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import { fileExists } from "./ioAndMigrations.js";
import {
  collectContainerBindingsFromProviderSource,
  deriveProviderDisplayName
} from "./packageIntrospection/providerBindingIntrospection.js";
import {
  describePackageExports,
  formatPackageSubpathImport,
  shouldShowPackageExportTarget
} from "./packageIntrospection/exportEntries.js";
import {
  classifyExportedSymbols,
  collectExportFileSymbolSummaries
} from "./packageIntrospection/exportedSymbols.js";
import {
  normalizePlacementContributions,
  normalizePlacementOutlets
} from "./packageIntrospection/placementNormalization.js";

async function inspectPackageOfferings({ packageEntry }) {
  const rootDir = String(packageEntry?.rootDir || "").trim();
  const notes = [];
  const details = {
    available: Boolean(rootDir),
    notes,
    packageExports: [],
    containerBindings: {
      server: [],
      client: []
    },
    exportedSymbols: []
  };

  if (!rootDir) {
    notes.push("Source files are unavailable for static introspection (catalog metadata only).");
    return details;
  }

  const packageJson = ensureObject(packageEntry?.packageJson);
  details.packageExports = await describePackageExports({
    packageRoot: rootDir,
    packageJson
  });

  const runtime = ensureObject(packageEntry?.descriptor?.runtime);
  const runtimeSides = [
    {
      side: "server",
      providers: ensureArray(ensureObject(runtime.server).providers)
    },
    {
      side: "client",
      providers: ensureArray(ensureObject(runtime.client).providers)
    }
  ];

  for (const runtimeSide of runtimeSides) {
    const side = String(runtimeSide.side || "").trim();
    if (!side) {
      continue;
    }
    const bindings = [];
    for (const provider of runtimeSide.providers) {
      const record = ensureObject(provider);
      const entrypoint = String(record.entrypoint || "").trim();
      const exportName = String(record.export || "").trim();
      if (!entrypoint) {
        continue;
      }

      const providerLabel = exportName ? `${entrypoint}#${exportName}` : entrypoint;
      if (entrypoint.includes("*")) {
        notes.push(`Skipped wildcard provider entrypoint during introspection: ${providerLabel}`);
        continue;
      }

      const providerPath = path.resolve(rootDir, entrypoint);
      if (!(await fileExists(providerPath))) {
        notes.push(`Provider file missing during introspection: ${providerLabel}`);
        continue;
      }

      let source = "";
      try {
        source = await readFile(providerPath, "utf8");
      } catch (error) {
        notes.push(`Failed reading provider ${providerLabel}: ${String(error?.message || error || "unknown error")}`);
        continue;
      }

      bindings.push(
        ...collectContainerBindingsFromProviderSource({
          source,
          providerLabel,
          entrypoint,
          providerExportName: exportName
        })
      );
    }

    details.containerBindings[side] = bindings.sort((left, right) => {
      const tokenComparison = String(left?.token || "").localeCompare(String(right?.token || ""));
      if (tokenComparison !== 0) {
        return tokenComparison;
      }
      const providerComparison = String(left?.provider || "").localeCompare(String(right?.provider || ""));
      if (providerComparison !== 0) {
        return providerComparison;
      }
      return Number(left?.line || 0) - Number(right?.line || 0);
    });
  }

  details.exportedSymbols = await collectExportFileSymbolSummaries({
    packageRoot: rootDir,
    packageExports: details.packageExports,
    notes
  });

  return details;
}

export {
  classifyExportedSymbols,
  deriveProviderDisplayName,
  formatPackageSubpathImport,
  inspectPackageOfferings,
  normalizePlacementContributions,
  normalizePlacementOutlets,
  shouldShowPackageExportTarget
};
