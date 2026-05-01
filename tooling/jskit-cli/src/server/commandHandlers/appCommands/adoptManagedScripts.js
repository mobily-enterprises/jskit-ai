import path from "node:path";
import { rm } from "node:fs/promises";
import {
  APP_SCRIPT_WRAPPERS,
  COPIED_APP_SCRIPT_FILES,
  COPIED_APP_SCRIPT_VALUES
} from "../appCommandCatalog.js";
import { fileExists, isTruthyFlag } from "./shared.js";

function shouldRewriteScript(currentValue = "", scriptName = "", force = false) {
  const desiredValue = APP_SCRIPT_WRAPPERS[scriptName];
  const normalizedCurrentValue = String(currentValue || "").trim();
  if (!normalizedCurrentValue) {
    return {
      rewrite: true,
      reason: "missing"
    };
  }
  if (normalizedCurrentValue === desiredValue) {
    return {
      rewrite: false,
      reason: "already-current"
    };
  }
  if ((COPIED_APP_SCRIPT_VALUES[scriptName] || []).includes(normalizedCurrentValue)) {
    return {
      rewrite: true,
      reason: "copied"
    };
  }
  if (force) {
    return {
      rewrite: true,
      reason: "force"
    };
  }
  return {
    rewrite: false,
    reason: "customized"
  };
}

async function runAppAdoptManagedScriptsCommand(ctx = {}, { appRoot = "", options = {}, stdout }) {
  const {
    loadAppPackageJson,
    writeJsonFile
  } = ctx;

  const dryRun = options?.dryRun === true;
  const force = isTruthyFlag(options?.inlineOptions?.force);
  const {
    packageJsonPath,
    packageJson
  } = await loadAppPackageJson(appRoot);

  const packageJsonClone = JSON.parse(JSON.stringify(packageJson || {}));
  const scripts = packageJsonClone.scripts && typeof packageJsonClone.scripts === "object"
    ? packageJsonClone.scripts
    : {};
  packageJsonClone.scripts = scripts;

  const changedScripts = [];
  const skippedScripts = [];

  for (const [scriptName, desiredValue] of Object.entries(APP_SCRIPT_WRAPPERS)) {
    const currentValue = String(scripts[scriptName] || "");
    const rewritePolicy = shouldRewriteScript(currentValue, scriptName, force);
    if (!rewritePolicy.rewrite) {
      if (rewritePolicy.reason === "customized") {
        skippedScripts.push({
          scriptName,
          currentValue
        });
      }
      continue;
    }

    scripts[scriptName] = desiredValue;
    changedScripts.push({
      scriptName,
      previousValue: currentValue,
      nextValue: desiredValue,
      reason: rewritePolicy.reason
    });
  }

  const removableCopiedFiles = [];
  if (force) {
    for (const relativePath of COPIED_APP_SCRIPT_FILES) {
      const absolutePath = path.join(appRoot, relativePath);
      if (await fileExists(absolutePath)) {
        removableCopiedFiles.push({
          relativePath,
          absolutePath
        });
      }
    }
  }

  if (!dryRun && changedScripts.length > 0) {
    await writeJsonFile(packageJsonPath, packageJsonClone);
  }

  if (!dryRun && force) {
    for (const { absolutePath } of removableCopiedFiles) {
      await rm(absolutePath, { recursive: true, force: true });
    }
  }

  if (changedScripts.length < 1 && skippedScripts.length < 1 && removableCopiedFiles.length < 1) {
    stdout.write("[adopt-managed-scripts] package.json already uses the managed JSKIT wrappers.\n");
    return 0;
  }

  for (const record of changedScripts) {
    stdout.write(`[adopt-managed-scripts] ${dryRun ? "would rewrite" : "rewrote"} script ${record.scriptName} (${record.reason}).\n`);
  }
  for (const record of skippedScripts) {
    stdout.write(`[adopt-managed-scripts] kept customized script ${record.scriptName}: ${record.currentValue}\n`);
  }
  for (const record of removableCopiedFiles) {
    stdout.write(`[adopt-managed-scripts] ${dryRun ? "would remove" : "removed"} ${record.relativePath}\n`);
  }

  if (skippedScripts.length > 0 && !force) {
    stdout.write("[adopt-managed-scripts] rerun with --force to replace customized maintenance wrappers too.\n");
  }

  return 0;
}

export { runAppAdoptManagedScriptsCommand };
