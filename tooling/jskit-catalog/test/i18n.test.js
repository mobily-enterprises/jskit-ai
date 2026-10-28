import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as kernelI18n from "../../../packages/kernel/shared/i18n/index.js";
import {
  checkTranslations,
  exportTranslations,
  formatCheckReport,
  messageParams,
  parseMessage
} from "../scripts/i18n.mjs";
import { parseArgs, usage } from "../scripts/jskit.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));

const KERNEL_EN = { jskit: { errors: { not_found: "Not found.", validation_failed: "Validation failed." } } };
const AUTH_EN = {
  jskit: {
    auth: {
      login: {
        title: "Sign in",
        welcome: "Welcome back, {name}.",
        password: "Use at least {min} characters."
      },
      files: "{count} file | {count} files",
      identity: "{name} ({email})"
    }
  }
};
const FRENCH = {
  jskit: {
    auth: {
      login: {
        title: "Connexion",
        welcome: "Bon retour, {name}.",
        password: "Utilisez au moins {min} caractères."
      },
      files: "{count} fichier | {count} fichiers",
      identity: "{name} ({email})"
    },
    errors: { not_found: "Introuvable.", validation_failed: "Validation échouée." }
  }
};

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, json(value), "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writePackage(directory, manifest, catalog) {
  await writeJson(path.join(directory, "package.json"), {
    version: "0.1.0",
    type: "module",
    ...manifest,
    ...(catalog ? { exports: { ".": "./index.js", "./locales/en.json": "./locales/en.json" } } : {})
  });
  if (catalog) await writeJson(path.join(directory, "locales", "en.json"), catalog);
}

// An app that reaches auth-web through a local workspace package and the kernel
// directly; dev-only and non-JSKIT catalogs are not part of what it renders.
async function withApp(run) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-i18n-"));
  try {
    await writeJson(path.join(projectRoot, "package.json"), {
      name: "example-app",
      private: true,
      workspaces: ["packages/*"],
      dependencies: { "@jskit-ai/kernel": "0.1.0", "@local/main": "0.1.0", "other-lib": "1.0.0" },
      devDependencies: { "@jskit-ai/dev-only": "0.1.0" }
    });
    const modules = path.join(projectRoot, "node_modules");
    await writePackage(path.join(projectRoot, "packages", "main"), {
      name: "@local/main",
      dependencies: { "@jskit-ai/auth-web": "0.1.0" }
    });
    await mkdir(path.join(modules, "@local"), { recursive: true });
    await symlink(path.join(projectRoot, "packages", "main"), path.join(modules, "@local", "main"), "dir");
    await writePackage(path.join(modules, "@jskit-ai", "kernel"), { name: "@jskit-ai/kernel" }, KERNEL_EN);
    await writePackage(path.join(modules, "@jskit-ai", "auth-web"), {
      name: "@jskit-ai/auth-web",
      jskit: { kind: "runtime" },
      dependencies: { "@jskit-ai/kernel": "0.1.0" }
    }, AUTH_EN);
    await writePackage(path.join(modules, "@jskit-ai", "dev-only"), { name: "@jskit-ai/dev-only" },
      { jskit: { dev: { text: "Dev only" } } });
    await writePackage(path.join(modules, "other-lib"), { name: "other-lib" }, { jskit: { other: { text: "Other" } } });
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function translationPath(projectRoot, locale = "fr") {
  return path.join(projectRoot, "src", "locales", locale, "jskit.json");
}

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("the local message parser agrees with kernel/shared/i18n on every sample", () => {
  const samples = [
    "",
    "Sign in",
    "Welcome back, {name}.",
    "{ name } and {other}",
    "Write to support{'@'}example.com {'|'} {'{'}braces{'}'}",
    "{count} file | {count} files",
    "no files | one file | {count} files",
    "  spaced | choices  ",
    "{count} file of {name} | {count} files of {name}",
    "Price: {'$'}{amount} {'|'} {count} item | {count} items"
  ];
  const render = (parts, params) => parts.map((part) => (part.param === undefined ? part.text : String(params[part.param] ?? ""))).join("");
  const kernelChoice = (count, choices) => (choices === 2 ? (count === 1 ? 0 : 1) : Math.min(count, 2));
  for (const sample of samples) {
    assert.deepEqual(messageParams(sample), kernelI18n.messageParams(sample), sample);
    const choices = parseMessage(sample);
    const params = Object.fromEntries(messageParams(sample).map((name) => [name, `<${name}>`]));
    assert.equal(render(choices[0], params), kernelI18n.formatMessage(sample, params), sample);
    if (choices.length > 1) {
      for (const count of [0, 1, 2, 5]) {
        const counted = { ...params, count };
        assert.equal(render(choices[kernelChoice(count, choices.length)], counted), kernelI18n.formatMessage(sample, counted), `${sample} @ ${count}`);
      }
    }
  }
  assert.throws(() => parseMessage("Hello {name"), /Unclosed placeholder/u);
  assert.throws(() => kernelI18n.formatMessage("Hello {name"), /Unclosed placeholder/u);
});

test("jskit CLI parses i18n export and check with a canonical BCP 47 locale", () => {
  assert.deepEqual(parseArgs(["i18n", "export", "PT-br", "--root", "/tmp/example"]), {
    command: "i18n",
    subcommand: "export",
    locale: "pt-BR",
    projectRoot: path.resolve("/tmp/example")
  });
  assert.deepEqual(parseArgs(["i18n", "check", "--root=/tmp/example", "fr"]), {
    command: "i18n",
    subcommand: "check",
    locale: "fr",
    projectRoot: path.resolve("/tmp/example")
  });
  assert.equal(parseArgs(["i18n", "--help"]).help, true);
  assert.throws(() => parseArgs(["i18n"]), /Usage:/u);
  assert.throws(() => parseArgs(["i18n", "import", "fr"]), /Usage:/u);
  assert.throws(() => parseArgs(["i18n", "export"]), /needs a locale, such as fr or pt-BR/u);
  assert.throws(() => parseArgs(["i18n", "export", "fr_FR"]), /Invalid locale code "fr_FR"/u);
  assert.throws(() => parseArgs(["i18n", "export", "fr", "de"]), /Unknown argument: de/u);
  assert.throws(() => parseArgs(["i18n", "export", "fr", "--no-install"]), /only valid with jskit update/u);
  assert.throws(() => parseArgs(["i18n", "check", "fr", "--manifest", "a/package.json"]), /only valid with jskit update and jskit check/u);
  assert.throws(() => parseArgs(["check", "fr"]), /Unknown argument: fr/u);
});

test("jskit usage documents both i18n subcommands and the locale format", () => {
  const text = usage();
  assert.match(text, /^ {2}jskit i18n export <locale> \[--root <path>\]$/mu);
  assert.match(text, /^ {2}jskit i18n check <locale> \[--root <path>\]$/mu);
  assert.match(text, /src\/locales\/<locale>\/jskit\.json/u);
  assert.match(text, /BCP 47 language tag, such as fr or pt-BR/u);
});

test("export writes the merged English of the app's installed JSKIT packages", async () => {
  await withApp(async (projectRoot) => {
    const result = await exportTranslations({ projectRoot, locale: "fr" });
    const english = { jskit: { ...AUTH_EN.jskit, ...KERNEL_EN.jskit } };

    assert.deepEqual(result.packageIds, ["@jskit-ai/auth-web", "@jskit-ai/kernel"]);
    assert.deepEqual([result.added, result.kept, result.extra, result.changed], [7, 0, 0, true]);
    assert.equal(await readFile(translationPath(projectRoot), "utf8"), json(english));
  });
});

test("export through the CLI uses the canonical locale in the path and prints counts", async () => {
  await withApp(async (projectRoot) => {
    const { code, stdout } = await runCli(["i18n", "export", "pt-br", "--root", projectRoot]);

    assert.equal(code, 0);
    assert.equal(stdout, "Wrote src/locales/pt-BR/jskit.json from 2 JSKIT package(s): 7 added, 0 kept, 0 extra.\n");
    assert.equal((await readJson(translationPath(projectRoot, "pt-BR"))).jskit.auth.login.title, "Sign in");
  });
});

test("export keeps existing translations and extra keys and adds only missing English", async () => {
  await withApp(async (projectRoot) => {
    await writeJson(translationPath(projectRoot), {
      jskit: {
        auth: { login: { title: "Connexion", retired: "Ancien texte" } },
        errors: { not_found: "Introuvable." },
        legacy: { note: "Garder" }
      }
    });

    const result = await exportTranslations({ projectRoot, locale: "fr" });
    const written = await readFile(translationPath(projectRoot), "utf8");

    assert.deepEqual([result.added, result.kept, result.extra], [5, 2, 2]);
    assert.equal(written, json({
      jskit: {
        auth: {
          login: {
            title: "Connexion",
            welcome: "Welcome back, {name}.",
            password: "Use at least {min} characters.",
            retired: "Ancien texte"
          },
          files: "{count} file | {count} files",
          identity: "{name} ({email})"
        },
        errors: { not_found: "Introuvable.", validation_failed: "Validation failed." },
        legacy: { note: "Garder" }
      }
    }));

    const { code, stdout } = await runCli(["i18n", "export", "fr", "--root", projectRoot]);
    assert.equal(code, 0);
    assert.equal(stdout,
      "src/locales/fr/jskit.json is already up to date with 2 JSKIT package(s): 0 added, 7 kept, 2 extra.\n" +
      "Extra keys are kept; jskit i18n check fr lists them.\n");
    assert.equal(await readFile(translationPath(projectRoot), "utf8"), written);
  });
});

test("export refuses to overwrite a file whose keys cannot coexist with JSKIT's", async () => {
  await withApp(async (projectRoot) => {
    await writeJson(translationPath(projectRoot), { jskit: { auth: { login: "Connexion" } } });
    const before = await readFile(translationPath(projectRoot), "utf8");

    await assert.rejects(exportTranslations({ projectRoot, locale: "fr" }),
      /cannot hold both jskit\.auth\.login and jskit\.auth\.login\.title/u);
    assert.equal(await readFile(translationPath(projectRoot), "utf8"), before);
  });
});

test("check passes a complete translation and warns about untranslated text only", async () => {
  await withApp(async (projectRoot) => {
    await writeJson(translationPath(projectRoot), FRENCH);
    const clean = await checkTranslations({ projectRoot, locale: "fr" });
    assert.equal(clean.ok, true);
    // identity has no words of its own, so keeping it as is is not a warning.
    assert.deepEqual(clean.untranslated, []);
    assert.equal(formatCheckReport(clean, projectRoot),
      "src/locales/fr/jskit.json covers the English of 2 JSKIT package(s), 7 message(s).");

    await writeJson(translationPath(projectRoot), {
      jskit: { ...FRENCH.jskit, auth: { ...FRENCH.jskit.auth, login: { ...FRENCH.jskit.auth.login, title: "Sign in" } } }
    });
    const { code, stdout } = await runCli(["i18n", "check", "fr", "--root", projectRoot]);
    assert.equal(code, 0);
    assert.equal(stdout,
      "Untranslated, same as English (warning) (1):\n" +
      "  jskit.auth.login.title\n" +
      "src/locales/fr/jskit.json covers the English of 2 JSKIT package(s), 7 message(s).\n");
  });
});

test("check reports extra keys without failing", async () => {
  await withApp(async (projectRoot) => {
    await writeJson(translationPath(projectRoot), { jskit: { ...FRENCH.jskit, legacy: { note: "Garder" } } });
    const result = await checkTranslations({ projectRoot, locale: "fr" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.extra, ["jskit.legacy.note"]);

    const { code, stdout } = await runCli(["i18n", "check", "fr", "--root", projectRoot]);
    assert.equal(code, 0);
    assert.match(stdout, /^Extra keys \(not used by the installed packages\) \(1\):\n {2}jskit\.legacy\.note\n/u);
  });
});

test("check fails on missing keys, placeholder and plural mismatches and invalid messages", async () => {
  await withApp(async (projectRoot) => {
    await writeJson(translationPath(projectRoot), {
      jskit: {
        auth: {
          login: {
            title: "Connexion",
            welcome: "Bon retour, {nom}.",
            password: "Utilisez au moins {min caractères."
          },
          files: "{count} fichiers",
          identity: "{name} {'|'} {email} | {email}"
        },
        errors: { not_found: 404 }
      }
    });

    const result = await checkTranslations({ projectRoot, locale: "fr" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["jskit.errors.validation_failed"]);
    assert.deepEqual(result.invalid, [
      "jskit.auth.login.password: Unclosed placeholder in message: Utilisez au moins {min caractères.",
      "jskit.errors.not_found: not a string"
    ]);
    assert.deepEqual(result.mismatched, [
      "jskit.auth.login.welcome: missing {name}; unexpected {nom}",
      "jskit.auth.files: 1 plural choice(s), English has 2",
      "jskit.auth.identity: 2 plural choices, English has none (write a literal | as {'|'})"
    ]);

    const { code, stdout, stderr } = await runCli(["i18n", "check", "fr", "--root", projectRoot]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.equal(stderr, [
      "Missing keys (1):",
      "  jskit.errors.validation_failed",
      "Invalid messages (2):",
      "  jskit.auth.login.password: Unclosed placeholder in message: Utilisez au moins {min caractères.",
      "  jskit.errors.not_found: not a string",
      "Placeholder mismatches (3):",
      "  jskit.auth.login.welcome: missing {name}; unexpected {nom}",
      "  jskit.auth.files: 1 plural choice(s), English has 2",
      "  jskit.auth.identity: 2 plural choices, English has none (write a literal | as {'|'})",
      "src/locales/fr/jskit.json does not match the English of 2 JSKIT package(s), 7 message(s).",
      ""
    ].join("\n"));
  });
});

test("check fails on missing keys alone and explains a missing file or install", async () => {
  await withApp(async (projectRoot) => {
    const { code, stderr } = await runCli(["i18n", "check", "fr", "--root", projectRoot]);
    assert.equal(code, 1);
    assert.equal(stderr, "src/locales/fr/jskit.json does not exist; run jskit i18n export fr first.\n");

    await writeJson(translationPath(projectRoot), { jskit: { auth: FRENCH.jskit.auth } });
    const missing = await runCli(["i18n", "check", "fr", "--root", projectRoot]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /^Missing keys \(2\):\n {2}jskit\.errors\.not_found\n {2}jskit\.errors\.validation_failed\n/u);

    await rm(path.join(projectRoot, "node_modules"), { recursive: true, force: true });
    await assert.rejects(checkTranslations({ projectRoot, locale: "fr" }), /run npm install first/u);
  });
});
