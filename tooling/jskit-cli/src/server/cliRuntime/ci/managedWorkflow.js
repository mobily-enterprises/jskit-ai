import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { directoryLooksLikeJskitAppRoot } from "../appState.js";
import {
  readFileBufferIfExists
} from "../ioAndMigrations.js";
import { loadInstalledAppPackageRegistry } from "../packageRegistries.js";
import {
  CiCompositionError,
  composeCiContributions
} from "./composer.js";
import {
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  renderGithubWorkflow
} from "./githubWorkflow.js";

function collectInstalledPackageEntries({ packageRegistry, installedPackageIds = null }) {
  const packageIds = Array.isArray(installedPackageIds)
    ? installedPackageIds
    : [...(packageRegistry?.keys?.() || [])];
  return [...new Set(packageIds.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((packageId) => {
      const packageEntry = packageRegistry?.get?.(packageId);
      if (!packageEntry) {
        throw new CiCompositionError(
          "metadata-missing",
          `Installed package metadata not found for ${packageId}. Run npm install before generating CI.`,
          { packageId }
        );
      }
      return packageEntry;
    });
}

function composeInstalledPackageCi({ packageRegistry, installedPackageIds = null }) {
  return composeCiContributions(
    collectInstalledPackageEntries({ packageRegistry, installedPackageIds })
  );
}

async function inspectCiFiles(appRoot) {
  const targetPath = path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  const target = await readFileBufferIfExists(targetPath);
  return {
    targetPath,
    target
  };
}

async function assertCiCanSynchronize({ appRoot }) {
  return inspectCiFiles(appRoot);
}

async function synchronizeCiWorkflow({
  appRoot,
  packageRegistry,
  installedPackageIds = null,
  touchedFiles = null,
  dryRun = false
}) {
  const model = composeInstalledPackageCi({ packageRegistry, installedPackageIds });
  const content = renderGithubWorkflow(model);
  const state = await assertCiCanSynchronize({ appRoot });
  const currentContent = state.target.exists ? state.target.buffer.toString("utf8") : "";
  const workflowChanged = currentContent !== content;

  if (!dryRun) {
    if (workflowChanged) {
      await mkdir(path.dirname(state.targetPath), { recursive: true });
      await writeFile(state.targetPath, content, "utf8");
    }
  }
  if (workflowChanged) {
    touchedFiles?.add?.(JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  }
  return {
    applicable: true,
    path: JSKIT_CI_WORKFLOW_RELATIVE_PATH,
    content,
    model,
    changed: workflowChanged,
    workflowChanged
  };
}

async function assertAppCiCanSynchronize({ appRoot }) {
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    return { applicable: false };
  }
  await assertCiCanSynchronize({ appRoot });
  return { applicable: true };
}

async function synchronizeAppCiWorkflow({ appRoot, dryRun = false }) {
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    return { applicable: false, changed: false };
  }
  return synchronizeCiWorkflow({
    appRoot,
    packageRegistry: await loadInstalledAppPackageRegistry(appRoot),
    dryRun
  });
}

export {
  assertAppCiCanSynchronize,
  composeInstalledPackageCi,
  synchronizeAppCiWorkflow,
  synchronizeCiWorkflow
};
