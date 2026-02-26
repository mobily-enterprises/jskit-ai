#!/usr/bin/env node
import process from "node:process";
import {
  resolveFrameworkExtensionsValidation,
  formatFrameworkExtensionsValidationResult,
  formatFrameworkExtensionsValidationFailure
} from "../server/framework/extensionsValidation.js";

function parseArgs(argv) {
  const output = {
    mode: undefined,
    enabledModuleIds: undefined,
    profileId: undefined,
    optionalModulePacks: undefined,
    extensionModulePaths: [],
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = String(argv[index] || "").trim();
    if (!rawArg) {
      continue;
    }

    if (rawArg === "--json") {
      output.json = true;
      continue;
    }

    if (rawArg === "--mode" || rawArg.startsWith("--mode=")) {
      const mode =
        rawArg === "--mode"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!mode) {
        throw new Error("Missing value for --mode.");
      }
      output.mode = mode;
      if (rawArg === "--mode") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--enabled" || rawArg.startsWith("--enabled=")) {
      const value =
        rawArg === "--enabled"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --enabled.");
      }
      output.enabledModuleIds = value;
      if (rawArg === "--enabled") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--profile" || rawArg.startsWith("--profile=")) {
      const value =
        rawArg === "--profile"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --profile.");
      }
      output.profileId = value;
      if (rawArg === "--profile") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--packs" || rawArg.startsWith("--packs=")) {
      const value =
        rawArg === "--packs"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --packs.");
      }
      output.optionalModulePacks = value;
      if (rawArg === "--packs") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--module" || rawArg.startsWith("--module=")) {
      const value =
        rawArg === "--module"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --module.");
      }
      output.extensionModulePaths.push(value);
      if (rawArg === "--module") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--modules" || rawArg.startsWith("--modules=")) {
      const value =
        rawArg === "--modules"
          ? String(argv[index + 1] || "").trim()
          : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --modules.");
      }
      output.extensionModulePaths.push(value);
      if (rawArg === "--modules") {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unsupported argument "${rawArg}".`);
  }

  return output;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await resolveFrameworkExtensionsValidation({
      mode: args.mode,
      enabledModuleIds: args.enabledModuleIds,
      profileId: args.profileId,
      optionalModulePacks: args.optionalModulePacks,
      extensionModulePaths: args.extensionModulePaths,
      cwd: process.cwd()
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(formatFrameworkExtensionsValidationResult(result));
    }
  } catch (error) {
    process.stderr.write(formatFrameworkExtensionsValidationFailure(error));
    process.exitCode = 1;
  }
}

await run();
