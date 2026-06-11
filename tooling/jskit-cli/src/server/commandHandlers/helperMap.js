function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeErrors(stdout, payload) {
  for (const error of payload.errors || []) {
    stdout.write(`[${error.code}] ${error.message}\n`);
    if (error.repairCommand) {
      stdout.write(`Repair: ${error.repairCommand}\n`);
    }
  }
}

function writeHelperMapText(stdout, payload) {
  if (Object.hasOwn(payload, "changed")) {
    stdout.write(
      payload.changed
        ? `Updated helper map at ${payload.helperMapMarkdownPath}.\n`
        : `Helper map is up to date at ${payload.helperMapMarkdownPath}.\n`
    );
    return;
  }
  if (payload.exists === false) {
    stdout.write(`No helper map set at ${payload.helperMapMarkdownPath}. Run jskit helper-map update.\n`);
    return;
  }
  if (payload.markdown) {
    stdout.write(payload.markdown);
    return;
  }
  stdout.write(`Helper map is up to date at ${payload.helperMapMarkdownPath}.\n`);
}

function createHelperMapCommands(ctx = {}) {
  const { resolveAppRootFromCwd } = ctx;

  async function commandHelperMap({
    positional = [],
    options = {},
    cwd,
    stdout
  } = {}) {
    const subcommand = String(positional[0] || "").trim();
    let payload;

    try {
      const appRoot = await resolveAppRootFromCwd(cwd);
      if (positional.length > 1) {
        payload = {
          ok: false,
          errors: [
            {
              code: "unexpected_helper_map_argument",
              message: `Unexpected helper-map argument: ${positional.slice(1).join(" ")}`,
              repairCommand: "jskit helper-map"
            }
          ]
        };
      } else if (!subcommand) {
        const { readHelperMap } = await import("../helperMap.js");
        payload = await readHelperMap({ targetRoot: appRoot });
      } else if (subcommand === "update") {
        const { updateHelperMap } = await import("../helperMap.js");
        payload = await updateHelperMap({ targetRoot: appRoot });
      } else {
        payload = {
          ok: false,
          errors: [
            {
              code: "unknown_helper_map_subcommand",
              message: `Unknown helper-map subcommand: ${subcommand}`,
              repairCommand: "jskit helper-map update"
            }
          ]
        };
      }
    } catch (error) {
      payload = {
        ok: false,
        errors: [
          {
            code: "helper_map_failed",
            message: String(error?.message || error),
            repairCommand: "jskit helper-map update"
          }
        ]
      };
    }

    if (options.json) {
      writeJson(stdout, payload);
    } else if (payload.ok === false) {
      writeErrors(stdout, payload);
    } else {
      writeHelperMapText(stdout, payload);
    }

    return payload.ok === false ? 1 : 0;
  }

  return { commandHelperMap };
}

export { createHelperMapCommands };
