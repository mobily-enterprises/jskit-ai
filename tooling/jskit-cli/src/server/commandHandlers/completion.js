import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  getCompletions,
  renderBashCompletionScript
} from "../cliRuntime/completion.js";

const INSTALL_MARKER_BEGIN = "# >>> jskit completion >>>";
const INSTALL_MARKER_END = "# <<< jskit completion <<<";

function resolveInstallBlock(relativeCompletionPath = "") {
  return [
    INSTALL_MARKER_BEGIN,
    `if [ -f "$HOME/${relativeCompletionPath}" ]; then`,
    `  source "$HOME/${relativeCompletionPath}"`,
    "fi",
    INSTALL_MARKER_END
  ].join("\n");
}

async function readTextFileIfExists(filePath = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (String(error?.code || "").trim().toUpperCase() === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function installBashCompletion() {
  const homeDirectory = os.homedir();
  const completionRelativePath = ".jskit/completion/bash/jskit.bash";
  const completionAbsolutePath = path.join(homeDirectory, completionRelativePath);
  const bashrcAbsolutePath = path.join(homeDirectory, ".bashrc");
  const installBlock = resolveInstallBlock(completionRelativePath);

  await mkdir(path.dirname(completionAbsolutePath), { recursive: true });
  await writeFile(completionAbsolutePath, renderBashCompletionScript(), "utf8");

  const existingBashrc = await readTextFileIfExists(bashrcAbsolutePath);
  const markerPattern = new RegExp(
    `${INSTALL_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${INSTALL_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "u"
  );
  const normalizedExisting = String(existingBashrc || "");
  const nextBashrc = markerPattern.test(normalizedExisting)
    ? normalizedExisting.replace(markerPattern, installBlock)
    : `${normalizedExisting.replace(/\s*$/u, "")}${normalizedExisting.trim() ? "\n\n" : ""}${installBlock}\n`;

  if (nextBashrc !== normalizedExisting) {
    await writeFile(bashrcAbsolutePath, nextBashrc, "utf8");
  }

  return {
    completionAbsolutePath,
    bashrcAbsolutePath
  };
}

function createCompletionCommands(ctx = {}) {
  const {
    createCliError,
    resolveAppRootFromCwd
  } = ctx;

  async function commandCompletion({ positional = [], options = {}, cwd = "", stdout }) {
    const shell = String(positional[0] || "").trim().toLowerCase();
    if (shell !== "bash") {
      throw createCliError(`Unsupported completion shell: ${shell || "<empty>"}.`, { showUsage: true });
    }

    const installRequested = String(options?.inlineOptions?.install || "").trim().toLowerCase() === "true";
    const mode = String(positional[1] || "").trim();
    if (installRequested && mode) {
      throw createCliError("jskit completion bash --install does not accept internal completion mode arguments.", {
        showUsage: true
      });
    }

    if (installRequested) {
      const {
        completionAbsolutePath,
        bashrcAbsolutePath
      } = await installBashCompletion();
      stdout.write(`Installed Bash completion to ${completionAbsolutePath}.\n`);
      stdout.write(`Updated ${bashrcAbsolutePath}.\n`);
      stdout.write("Run: source ~/.bashrc\n");
      return 0;
    }

    if (!mode) {
      stdout.write(renderBashCompletionScript());
      return 0;
    }

    if (mode !== "__complete__") {
      throw createCliError(`Unknown completion mode: ${mode}.`, { showUsage: true });
    }

    const rawCword = Number.parseInt(String(positional[2] || "0"), 10);
    const words = positional.slice(3).map((value) => String(value ?? ""));

    let appRoot = String(cwd || process.cwd());
    try {
      appRoot = await resolveAppRootFromCwd(appRoot);
    } catch {
      // Fall back to cwd so top-level completion still works outside an app root.
    }

    const completions = await getCompletions({
      appRoot,
      words,
      cword: Number.isInteger(rawCword) ? rawCword : 0
    });
    if (completions.length > 0) {
      stdout.write(`${completions.join("\n")}\n`);
    }
    return 0;
  }

  return {
    commandCompletion
  };
}

export { createCompletionCommands };
