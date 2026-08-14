import { spawn } from "node:child_process";
import path from "node:path";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import { resolvePackageTemplateRoot } from "../../cliRuntime/packageTemplateResolution.js";
import { fileExists } from "../appCommands/shared.js";
import {
  collectCapacitorShellInstallIssues,
  ensureAndroidManifestDeepLinks,
  ensureAndroidNativeShellIdentity,
  ensureMobileConfigStub
} from "../mobileShellSupport.js";

function renderWrappedShellCommand(binaryName, args = [], {
  maxWidth = 100,
  continuationIndent = "  "
} = {}) {
  const tokens = [
    String(binaryName || "").trim(),
    ...ensureArray(args).map((entry) => String(entry || "").trim()).filter(Boolean)
  ];
  if (tokens.length < 1 || !tokens[0]) {
    return "$";
  }

  let currentLine = "$";
  const renderedLines = [];
  for (const token of tokens) {
    if (`${currentLine} ${token}`.length <= maxWidth || currentLine === "$") {
      currentLine = `${currentLine} ${token}`;
      continue;
    }

    renderedLines.push(`${currentLine} \\`);
    currentLine = `${continuationIndent}${token}`;
  }

  renderedLines.push(currentLine);
  return renderedLines.join("\n");
}

async function runLocalProjectBinary(binaryName, args = [], {
  appRoot,
  io,
  pathModule = path,
  createCliError,
  explanation = "",
  dryRun = false
} = {}) {
  const renderedArgs = Array.isArray(args) ? args.join(" ") : "";
  if (explanation) {
    io?.stdout?.write(`${explanation}\n`);
    io?.stdout?.write(`${renderWrappedShellCommand(binaryName, args)}\n`);
  }
  if (dryRun === true) {
    io?.stdout?.write(`[dry-run] ${binaryName}${renderedArgs ? ` ${renderedArgs}` : ""}\n`);
    return;
  }

  const localBinDirectory = pathModule.join(appRoot, "node_modules", ".bin");
  const inheritedPath = String(process.env.PATH || "");
  await new Promise((resolve, reject) => {
    const child = spawn(binaryName, Array.isArray(args) ? args : [], {
      cwd: appRoot,
      env: {
        ...process.env,
        PATH: `${localBinDirectory}${pathModule.delimiter}${inheritedPath}`
      },
      stdio: "inherit"
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          createCliError(
            `Could not find local "${binaryName}" in node_modules/.bin. Re-run the package install after dependencies are installed.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(createCliError(`${binaryName} ${args.join(" ")} failed with exit code ${code}.`));
    });
  });
}

async function installAppDependencies({
  appRoot,
  io,
  pathModule,
  createCliError,
  dryRun
}) {
  await runLocalProjectBinary("npm", ["install"], {
    appRoot,
    io,
    pathModule,
    createCliError,
    explanation: "[mobile] Installing app dependencies for the mobile shell:",
    dryRun
  });
}

function validateHookResult(result, { packageId = "", hookLabel = "" } = {}) {
  if (typeof result === "undefined" || result === null) {
    return {};
  }
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${packageId} ${hookLabel} must return an object when it returns a value.`);
  }
  return result;
}

async function loadInstallHook({
  packageEntry,
  appRoot,
  hookSpec,
  hookLabel
}) {
  const entrypoint = String(hookSpec?.entrypoint || "").trim();
  const exportName = String(hookSpec?.export || "").trim() || "default";
  if (!entrypoint) {
    return null;
  }

  const templateRoot = await resolvePackageTemplateRoot({ packageEntry, appRoot });
  const absoluteEntrypointPath = path.resolve(templateRoot, entrypoint);
  if (!(await fileExists(absoluteEntrypointPath))) {
    throw new Error(`${packageEntry.packageId} ${hookLabel} entrypoint not found at ${entrypoint}.`);
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await importFreshModuleFromAbsolutePath(absoluteEntrypointPath);
  } catch (error) {
    throw new Error(
      `Unable to load ${hookLabel} entrypoint ${entrypoint} for ${packageEntry.packageId}: ${String(error?.message || error || "unknown error")}`
    );
  }

  const handler = exportName === "default" ? moduleNamespace?.default : moduleNamespace?.[exportName];
  if (typeof handler !== "function") {
    throw new Error(`${packageEntry.packageId} ${hookLabel} export "${exportName}" is not a function.`);
  }
  return handler;
}

function createInstallHookHelpers({
  ctx,
  appRoot,
  io,
  appPackageJson
}) {
  return Object.freeze({
    ensureManagedMobileConfig: async ({ dryRun = false } = {}) =>
      await ensureMobileConfigStub({
        ctx,
        appRoot,
        packageJson: appPackageJson,
        dryRun,
        stdout: io?.stdout
      }),
    installAppDependencies: async ({ dryRun = false } = {}) =>
      await installAppDependencies({
        appRoot,
        io,
        pathModule: ctx.path,
        createCliError: ctx.createCliError,
        dryRun
      }),
    runProjectBinary: async (binaryName, args = [], { dryRun = false, explanation = "" } = {}) =>
      await runLocalProjectBinary(binaryName, args, {
        appRoot,
        io,
        pathModule: ctx.path,
        createCliError: ctx.createCliError,
        explanation,
        dryRun
      }),
    collectCapacitorShellInstallIssues: async () =>
      await collectCapacitorShellInstallIssues({ ctx, appRoot }),
    ensureAndroidManifestDeepLinks: async ({ dryRun = false } = {}) =>
      await ensureAndroidManifestDeepLinks({
        ctx,
        appRoot,
        dryRun,
        stdout: io?.stdout
      }),
    ensureAndroidNativeShellIdentity: async ({ dryRun = false } = {}) =>
      await ensureAndroidNativeShellIdentity({
        ctx,
        appRoot,
        dryRun,
        stdout: io?.stdout
      }),
    fileExists
  });
}

function resolveInstallHookSpec(packageEntry, stage) {
  return ensureObject(
    ensureObject(
      ensureObject(packageEntry?.packageMetadata).lifecycle
    ).install
  )[stage];
}

function packageManagesNpmInstall(packageEntry) {
  return resolveInstallHookSpec(packageEntry, "finalize")?.managesNpmInstall === true;
}

async function invokeInstallHook({
  packageEntry,
  appRoot,
  hookSpec,
  hookLabel,
  hookContext,
  createCliError
}) {
  if (!hookSpec || Object.keys(ensureObject(hookSpec)).length < 1) {
    return {};
  }

  const handler = await loadInstallHook({
    packageEntry,
    appRoot,
    hookSpec,
    hookLabel
  });
  if (!handler) {
    return {};
  }

  let result = null;
  try {
    result = await handler(hookContext);
  } catch (error) {
    throw createCliError(
      `${packageEntry.packageId} ${hookLabel} failed: ${String(error?.message || error || "unknown error")}`
    );
  }
  return validateHookResult(result, {
    packageId: packageEntry.packageId,
    hookLabel
  });
}

export {
  createInstallHookHelpers,
  invokeInstallHook,
  packageManagesNpmInstall,
  resolveInstallHookSpec
};
