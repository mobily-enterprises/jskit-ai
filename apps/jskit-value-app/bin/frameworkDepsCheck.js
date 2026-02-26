#!/usr/bin/env node
import process from "node:process";
import {
  resolveFrameworkDependencyCheck,
  formatFrameworkDependencyCheckResult,
  formatFrameworkDependencyCheckFailure
} from "../server/framework/dependencyCheck.js";

function parseArgs(argv) {
  const output = {
    mode: undefined,
    enabledModuleIds: undefined,
    profileId: undefined,
    optionalModulePacks: undefined,
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

    throw new Error(`Unsupported argument "${rawArg}".`);
  }

  return output;
}

function run() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = resolveFrameworkDependencyCheck({
      mode: args.mode,
      enabledModuleIds: args.enabledModuleIds,
      profileId: args.profileId,
      optionalModulePacks: args.optionalModulePacks
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(formatFrameworkDependencyCheckResult(result));
    }
  } catch (error) {
    process.stderr.write(formatFrameworkDependencyCheckFailure(error));
    process.exitCode = 1;
  }
}

run();
