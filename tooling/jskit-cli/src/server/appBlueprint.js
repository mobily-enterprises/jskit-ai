import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  PROMPT_DIRECTORY
} from "./sessionRuntime/constants.js";
import {
  fileExists,
  normalizeText,
  readTextIfExists,
  writeTextFile
} from "./sessionRuntime/io.js";
import {
  renderTemplate
} from "./sessionRuntime/promptRenderer.js";

const APP_BLUEPRINT_RELATIVE_PATH = ".jskit/APP_BLUEPRINT.md";
const APP_PROMPT_OVERRIDE_RELATIVE_ROOT = ".jskit/prompts";

function resolveAppBlueprintPaths(targetRoot = process.cwd()) {
  const normalizedTargetRoot = path.resolve(normalizeText(targetRoot) || process.cwd());
  return Object.freeze({
    appBlueprintPath: path.join(normalizedTargetRoot, APP_BLUEPRINT_RELATIVE_PATH),
    promptOverrideRoot: path.join(normalizedTargetRoot, APP_PROMPT_OVERRIDE_RELATIVE_ROOT),
    targetRoot: normalizedTargetRoot
  });
}

function extractAppBlueprintText(value = "") {
  const text = normalizeText(value);
  const match = /\[app_blueprint\]([\s\S]*?)\[\/app_blueprint\]/u.exec(text);
  return normalizeText(match ? match[1] : text);
}

async function readAppPromptTemplate(paths, templateName) {
  const normalizedName = normalizeText(templateName);
  const overridePath = path.join(paths.promptOverrideRoot, normalizedName);
  if (await fileExists(overridePath)) {
    return readTextIfExists(overridePath);
  }
  return readTextIfExists(path.join(PROMPT_DIRECTORY, normalizedName));
}

async function renderAppBlueprintPrompt({ targetRoot = process.cwd(), appBrief = "" } = {}) {
  const paths = resolveAppBlueprintPaths(targetRoot);
  const normalizedBrief = normalizeText(appBrief);
  if (!normalizedBrief) {
    return {
      ok: false,
      appBlueprintPath: paths.appBlueprintPath,
      errors: [
        {
          code: "app_brief_required",
          message: "jskit blueprint prompt requires --brief, --brief-file, or --brief -.",
          repairCommand: "jskit blueprint prompt --brief \"<what app are we building>\""
        }
      ],
      prompt: ""
    };
  }
  const template = await readAppPromptTemplate(paths, "app_blueprint.md");
  return {
    ok: true,
    appBlueprintPath: paths.appBlueprintPath,
    errors: [],
    prompt: renderTemplate(template, {
      app_brief: normalizedBrief
    }).trim()
  };
}

async function readAppBlueprint({ targetRoot = process.cwd() } = {}) {
  const paths = resolveAppBlueprintPaths(targetRoot);
  const blueprintText = await readTextIfExists(paths.appBlueprintPath);
  return {
    ok: true,
    appBlueprintPath: paths.appBlueprintPath,
    blueprintText: blueprintText.trim(),
    exists: Boolean(blueprintText.trim()),
    errors: []
  };
}

async function writeAppBlueprint({ targetRoot = process.cwd(), appBlueprint = "" } = {}) {
  const paths = resolveAppBlueprintPaths(targetRoot);
  const blueprintText = extractAppBlueprintText(appBlueprint);
  if (!blueprintText) {
    return {
      ok: false,
      appBlueprintPath: paths.appBlueprintPath,
      blueprintText: "",
      exists: false,
      errors: [
        {
          code: "app_blueprint_required",
          message: "jskit blueprint set requires --blueprint, --blueprint-file, or --blueprint -.",
          repairCommand: "jskit blueprint set --blueprint -"
        }
      ]
    };
  }
  await mkdir(path.dirname(paths.appBlueprintPath), { recursive: true });
  await writeTextFile(paths.appBlueprintPath, blueprintText);
  return {
    ok: true,
    appBlueprintPath: paths.appBlueprintPath,
    blueprintText,
    exists: true,
    errors: []
  };
}

async function readTextInputFile(cwd, inputPath) {
  const resolvedPath = path.resolve(cwd, normalizeText(inputPath));
  return readFile(resolvedPath, "utf8");
}

export {
  APP_BLUEPRINT_RELATIVE_PATH,
  APP_PROMPT_OVERRIDE_RELATIVE_ROOT,
  extractAppBlueprintText,
  readAppBlueprint,
  readTextInputFile,
  renderAppBlueprintPrompt,
  resolveAppBlueprintPaths,
  writeAppBlueprint
};
