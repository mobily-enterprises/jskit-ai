import {
  readAppBlueprint,
  readTextInputFile,
  renderAppBlueprintPrompt,
  writeAppBlueprint
} from "../appBlueprint.js";

function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeBlueprintText(stdout, payload) {
  if (payload.prompt) {
    stdout.write(`${payload.prompt}\n`);
    return;
  }
  if (payload.blueprintText) {
    stdout.write(`${payload.blueprintText}\n`);
    return;
  }
  stdout.write(`No app blueprint set at ${payload.appBlueprintPath}.\n`);
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveTextInput({
  cwd,
  fileOption,
  inlineOptions = {},
  io = {},
  stdinOption = "-",
  textOption
}) {
  if (Object.hasOwn(inlineOptions, fileOption)) {
    const inputFile = String(inlineOptions[fileOption] || "").trim();
    return inputFile ? readTextInputFile(cwd, inputFile) : "";
  }
  if (Object.hasOwn(inlineOptions, textOption)) {
    const textValue = String(inlineOptions[textOption] ?? "");
    return textValue === stdinOption ? readStream(io.stdin) : textValue;
  }
  return "";
}

function createBlueprintCommands(ctx = {}) {
  const { resolveAppRootFromCwd } = ctx;

  async function commandBlueprint({
    positional = [],
    options = {},
    cwd,
    stdout,
    io = {}
  } = {}) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const inlineOptions = options.inlineOptions || {};
    const subcommand = String(positional[0] || "").trim();
    let payload;

    try {
      if (positional.length > 1) {
        payload = {
          ok: false,
          appBlueprintPath: "",
          errors: [
            {
              code: "unexpected_blueprint_argument",
              message: `Unexpected blueprint argument: ${positional.slice(1).join(" ")}`,
              repairCommand: "jskit blueprint"
            }
          ]
        };
      } else if (!subcommand) {
        payload = await readAppBlueprint({ targetRoot: appRoot });
      } else if (subcommand === "prompt") {
        const appBrief = await resolveTextInput({
          cwd,
          fileOption: "brief-file",
          inlineOptions,
          io,
          textOption: "brief"
        });
        payload = await renderAppBlueprintPrompt({
          targetRoot: appRoot,
          appBrief
        });
      } else if (subcommand === "set") {
        const appBlueprint = await resolveTextInput({
          cwd,
          fileOption: "blueprint-file",
          inlineOptions,
          io,
          textOption: "blueprint"
        });
        payload = await writeAppBlueprint({
          targetRoot: appRoot,
          appBlueprint
        });
      } else {
        payload = {
          ok: false,
          appBlueprintPath: "",
          errors: [
            {
              code: "unknown_blueprint_subcommand",
              message: `Unknown blueprint subcommand: ${subcommand}`,
              repairCommand: "jskit blueprint"
            }
          ]
        };
      }
    } catch (error) {
      payload = {
        ok: false,
        appBlueprintPath: "",
        errors: [
          {
            code: "blueprint_input_read_failed",
            message: String(error?.message || error),
            repairCommand: "jskit blueprint"
          }
        ]
      };
    }

    if (options.json) {
      writeJson(stdout, payload);
    } else if (payload.ok === false) {
      for (const error of payload.errors || []) {
        stdout.write(`[${error.code}] ${error.message}\n`);
        if (error.repairCommand) {
          stdout.write(`Repair: ${error.repairCommand}\n`);
        }
      }
    } else {
      writeBlueprintText(stdout, payload);
    }

    return payload.ok === false ? 1 : 0;
  }

  return { commandBlueprint };
}

export { createBlueprintCommands };
