import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createCliError } from "./cliError.js";
import { ensureArray } from "./collectionUtils.js";

const OPTION_INTERPOLATION_PATTERN = /\$\{option:([a-z][a-z0-9-]*)(\|[^}]*)?\}/gi;

function normalizeSnippet(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trimEnd();
}

function appendTextSnippet(content, snippet, position = "bottom") {
  const normalizedContent = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const normalizedSnippet = normalizeSnippet(snippet);

  if (!normalizedSnippet) {
    return {
      changed: false,
      content: normalizedContent
    };
  }

  if (normalizedContent.includes(normalizedSnippet)) {
    return {
      changed: false,
      content: normalizedContent
    };
  }

  if (!normalizedContent) {
    return {
      changed: true,
      content: `${normalizedSnippet}\n`
    };
  }

  if (position === "top") {
    const nextContent = `${normalizedSnippet}\n\n${normalizedContent.replace(/^\n+/, "")}`.replace(/\n+$/, "\n");
    return {
      changed: true,
      content: nextContent
    };
  }

  const nextContent = `${normalizedContent.replace(/\n*$/, "\n\n")}${normalizedSnippet}\n`;
  return {
    changed: true,
    content: nextContent
  };
}

function normalizeSkipChecks(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  const one = String(value || "").trim();
  return one ? [one] : [];
}

function splitTextIntoWords(value) {
  const normalized = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}

function wordsToPascal(words) {
  return ensureArray(words)
    .map((entry) => {
      const value = String(entry || "").toLowerCase();
      if (!value) {
        return "";
      }
      return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
    })
    .join("");
}

function wordsToCamel(words) {
  const pascal = wordsToPascal(words);
  if (!pascal) {
    return "";
  }
  return `${pascal.slice(0, 1).toLowerCase()}${pascal.slice(1)}`;
}

function wordsToSnake(words) {
  return ensureArray(words)
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("_");
}

function wordsToKebab(words) {
  return ensureArray(words)
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function toSingularForm(value) {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return "";
  }

  const lastIndex = words.length - 1;
  const last = words[lastIndex];
  if (!last) {
    return wordsToKebab(words);
  }

  if (last.endsWith("ies") && last.length > 3) {
    words[lastIndex] = `${last.slice(0, -3)}y`;
    return wordsToKebab(words);
  }
  if (last.endsWith("sses") && last.length > 4) {
    words[lastIndex] = last.slice(0, -2);
    return wordsToKebab(words);
  }
  if (last.endsWith("s") && !last.endsWith("ss") && last.length > 1) {
    words[lastIndex] = last.slice(0, -1);
    return wordsToKebab(words);
  }

  return wordsToKebab(words);
}

function toPluralForm(value) {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return "";
  }

  const lastIndex = words.length - 1;
  const last = words[lastIndex];
  if (!last) {
    return wordsToKebab(words);
  }

  if (last.endsWith("s")) {
    return wordsToKebab(words);
  }
  if (/(x|z|ch|sh)$/i.test(last)) {
    words[lastIndex] = `${last}es`;
    return wordsToKebab(words);
  }
  if (last.endsWith("y") && !/[aeiou]y$/i.test(last)) {
    words[lastIndex] = `${last.slice(0, -1)}ies`;
    return wordsToKebab(words);
  }

  words[lastIndex] = `${last}s`;
  return wordsToKebab(words);
}

function normalizePathValue(value) {
  return String(value || "")
    .split("/")
    .map((segment) => wordsToKebab(splitTextIntoWords(segment)))
    .filter(Boolean)
    .join("/");
}

function parseTransformSpec(transform) {
  const normalized = String(transform || "").trim();
  if (!normalized) {
    return {
      name: "",
      args: []
    };
  }

  const match = /^([a-z][a-z0-9-]*)(?:\((.*)\))?$/i.exec(normalized);
  if (!match) {
    return {
      name: "",
      args: []
    };
  }

  const name = String(match[1] || "").trim().toLowerCase();
  const rawArgs = String(match[2] || "").trim();
  const args = rawArgs
    ? rawArgs.split(",").map((entry) => String(entry || "").trim())
    : [];

  return {
    name,
    args
  };
}

function applyOptionTransform(value, transform, ownerId, key, optionName) {
  const spec = parseTransformSpec(transform);
  const name = spec.name;
  if (!name) {
    return value;
  }

  if (name === "trim") {
    return String(value || "").trim();
  }
  if (name === "lower") {
    return String(value || "").toLowerCase();
  }
  if (name === "upper") {
    return String(value || "").toUpperCase();
  }
  if (name === "kebab") {
    return wordsToKebab(splitTextIntoWords(value));
  }
  if (name === "snake") {
    return wordsToSnake(splitTextIntoWords(value));
  }
  if (name === "pascal") {
    return wordsToPascal(splitTextIntoWords(value));
  }
  if (name === "camel") {
    return wordsToCamel(splitTextIntoWords(value));
  }
  if (name === "singular") {
    return toSingularForm(value);
  }
  if (name === "plural") {
    return toPluralForm(value);
  }
  if (name === "path") {
    return normalizePathValue(value);
  }
  if (name === "pathprefix") {
    const normalizedPath = normalizePathValue(value);
    return normalizedPath ? `${normalizedPath}/` : "";
  }
  if (name === "default") {
    const fallback = String(spec.args[0] || "");
    const normalized = String(value || "").trim();
    return normalized ? value : fallback;
  }
  if (name === "prefix") {
    const prefix = String(spec.args[0] || "");
    return `${prefix}${String(value || "")}`;
  }
  if (name === "suffix") {
    const suffix = String(spec.args[0] || "");
    return `${String(value || "")}${suffix}`;
  }

  throw createCliError(
    `Unknown option transform "${name}" while applying ${ownerId} mutation ${key} (option: ${optionName}).`
  );
}

function applyOptionTransformPipeline(rawValue, rawPipeline, ownerId, key, optionName) {
  let value = String(rawValue || "");
  const pipeline = String(rawPipeline || "")
    .split("|")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  for (const transform of pipeline) {
    value = applyOptionTransform(value, transform, ownerId, key, optionName);
  }

  return value;
}

function interpolateOptionValue(rawValue, options, ownerId, key) {
  return String(rawValue || "").replace(OPTION_INTERPOLATION_PATTERN, (_, optionName, rawPipeline = "") => {
    if (Object.prototype.hasOwnProperty.call(options, optionName)) {
      return applyOptionTransformPipeline(String(options[optionName]), rawPipeline, ownerId, key, optionName);
    }
    throw createCliError(
      `Missing required option ${optionName} while applying ${ownerId} mutation ${key}.`
    );
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSecretOptionInput(optionSchema) {
  const inputType = String(optionSchema?.inputType || "").trim().toLowerCase();
  if (inputType === "password" || inputType === "secret" || inputType === "hidden") {
    return true;
  }
  return optionSchema?.sensitive === true || optionSchema?.secret === true;
}

function createMutedReadlineOutput(stdout) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        stdout.write(chunk, encoding);
      }
      callback();
    }
  });

  return {
    output,
    setMuted(nextMuted) {
      muted = Boolean(nextMuted);
    }
  };
}

async function promptForRequiredOption({
  ownerType,
  ownerId,
  optionName,
  optionSchema,
  stdin = process.stdin,
  stdout = process.stdout
}) {
  const defaultValue = String(optionSchema?.defaultValue || "").trim();
  const promptLabel = String(optionSchema?.promptLabel || "").trim();
  const promptHint = String(optionSchema?.promptHint || "").trim();
  const required = Boolean(optionSchema?.required);
  const allowEmpty = optionSchema?.allowEmpty === true;

  if (!stdin?.isTTY || !stdout?.isTTY) {
    if (defaultValue) {
      return defaultValue;
    }
    if (required) {
      if (allowEmpty) {
        return "";
      }
      throw createCliError(
        `${ownerType} ${ownerId} requires option ${optionName}. Non-interactive mode requires --${optionName} <value>.`
      );
    }
    return "";
  }

  const label = promptLabel || `Select ${optionName} for ${ownerType} ${ownerId}`;
  const defaultHint = defaultValue ? ` [default: ${defaultValue}]` : "";
  const hintSuffix = promptHint ? ` ${promptHint}` : "";
  const promptText = `${label}${defaultHint}${hintSuffix}: `;

  let answer = "";

  if (isSecretOptionInput(optionSchema)) {
    const outputController = createMutedReadlineOutput(stdout);
    const rl = createInterface({
      input: stdin,
      output: outputController.output
    });

    try {
      stdout.write(promptText);
      outputController.setMuted(true);
      answer = String(await rl.question("")).trim();
    } finally {
      outputController.setMuted(false);
      stdout.write("\n");
      rl.close();
    }
  } else {
    const rl = createInterface({
      input: stdin,
      output: stdout
    });

    try {
      answer = String(await rl.question(promptText)).trim();
    } finally {
      rl.close();
    }
  }

  if (!answer && defaultValue) {
    return defaultValue;
  }
  if (!answer && required && !allowEmpty) {
    throw createCliError(`${ownerType} ${ownerId} requires option ${optionName}.`);
  }
  return answer || "";
}

export {
  appendTextSnippet,
  escapeRegExp,
  interpolateOptionValue,
  normalizeSkipChecks,
  promptForRequiredOption
};
