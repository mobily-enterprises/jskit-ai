import path from "node:path";
import {
  JSKIT_CLI_SHELL_RULE,
  PROMPT_DIRECTORY,
  SESSION_STATE_RELATIVE_PATH
} from "./constants.js";
import {
  fileExists,
  normalizeText,
  readTextIfExists
} from "./io.js";

async function readPromptTemplate(targetRoot, name) {
  const normalizedName = normalizeText(name);
  const overridePath = path.join(targetRoot, SESSION_STATE_RELATIVE_PATH, "prompts", normalizedName);
  if (await fileExists(overridePath)) {
    return readTextIfExists(overridePath);
  }
  return readTextIfExists(path.join(PROMPT_DIRECTORY, normalizedName));
}

function renderTemplate(source, values = {}) {
  return String(source || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/gu, (_match, key) => {
    return String(values[key] ?? "");
  });
}

function withShellCommandRule(template) {
  const body = String(template || "").trim();
  if (!body) {
    return JSKIT_CLI_SHELL_RULE;
  }
  if (body.includes("When running JSKIT CLI commands from the shell")) {
    return body;
  }
  return `${JSKIT_CLI_SHELL_RULE}\n\n---\n\n${body}`;
}

async function renderPrompt(paths, templateName, values = {}) {
  const template = await readPromptTemplate(paths.targetRoot, templateName);
  return renderTemplate(withShellCommandRule(template), {
    branch: paths.branch,
    session_id: paths.sessionId,
    worktree: paths.worktree,
    ...values
  }).trim();
}

export {
  readPromptTemplate,
  renderPrompt,
  renderTemplate,
  withShellCommandRule
};
