import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK_SOURCE = path.join(PACKAGE_ROOT, "app-guidance", "AGENTS.block.md");
const CATALOG = "@jskit-ai/jskit-catalog";
const BEGIN = "<!-- jskit:begin app guidance (written by npx jskit agents; edit outside this block) -->";
const END = "<!-- jskit:end app guidance -->";
const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#agent-instructions";
const FIX = "run `npx jskit agents` and commit AGENTS.md.";

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** This catalog's block, markers included, and its version. */
async function catalogBlock() {
  const [source, manifest] = await Promise.all([
    readFile(BLOCK_SOURCE, "utf8"),
    readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")
  ]);
  return { block: `${BEGIN}\n${source}${END}`, version: JSON.parse(manifest).version };
}

/**
 * Where AGENTS.md's block lies: `start` and `stop` around one begin marker followed by one end marker, nothing when
 * the file has neither, and `malformed` when its markers are not one such pair.
 * @param {string} text
 */
function locateBlock(text) {
  const begins = text.split(BEGIN).length - 1;
  const ends = text.split(END).length - 1;
  if (begins === 0 && ends === 0) return { found: false };
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begins !== 1 || ends !== 1 || end < start) {
    return {
      found: true,
      malformed: `AGENTS.md has ${begins} JSKIT begin marker(s) and ${ends} end marker(s)` +
        (begins === 1 && ends === 1 ? ", the end first" : "")
    };
  }
  return { found: true, start, stop: end + END.length };
}

/**
 * `jskit agents`: writes this catalog's block into the app's AGENTS.md, between its markers, or at the top of a file
 * without them, made if absent. Text outside the markers stays as it is.
 * @param {{ projectRoot: string }} options
 */
async function writeAgentsBlock({ projectRoot }) {
  const file = path.join(projectRoot, "AGENTS.md");
  const [{ block, version }, existing] = await Promise.all([catalogBlock(), readOptional(file)]);
  if (existing === null) {
    await writeFile(file, `${block}\n`);
    return { version, placed: "created", changed: true };
  }
  const located = locateBlock(existing);
  if (located.malformed) {
    throw new Error(`${located.malformed}; leave one pair, the begin marker first, or none, and run npx jskit agents again.`);
  }
  if (!located.found) {
    await writeFile(file, existing.trim() ? `${block}\n\n${existing}` : `${block}\n`);
    return { version, placed: "top", changed: true };
  }
  const next = `${existing.slice(0, located.start)}${block}${existing.slice(located.stop)}`;
  if (next !== existing) await writeFile(file, next);
  return { version, placed: "in place", changed: next !== existing };
}

function formatAgentsBlockWrite({ version, placed, changed }) {
  if (!changed) return `AGENTS.md already carries the JSKIT block of ${CATALOG} ${version}.`;
  const where = { created: "in a new AGENTS.md", top: "at the top of AGENTS.md", "in place": "in AGENTS.md, between its markers" }[placed];
  return `Wrote the JSKIT block of ${CATALOG} ${version} ${where}. Commit AGENTS.md.`;
}

/**
 * Plain `jskit check`'s part (`agents/jskit-block`): an app that declares this catalog carries its block in AGENTS.md
 * as `jskit agents` writes it. A project that does not declare the catalog pins no version whose block it could carry.
 * @param {{ projectRoot: string }} options
 */
async function checkAgentsBlock({ projectRoot }) {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  if (!manifest.dependencies?.[CATALOG] && !manifest.devDependencies?.[CATALOG]) {
    return { ok: true, applies: false, findings: [] };
  }
  const [{ block, version }, existing] = await Promise.all([
    catalogBlock(),
    readOptional(path.join(projectRoot, "AGENTS.md"))
  ]);
  const located = existing === null ? { found: false } : locateBlock(existing);
  let message = null;
  if (!located.found) {
    message = `AGENTS.md lacks the JSKIT block of ${CATALOG} ${version}: ${FIX}`;
  } else if (located.malformed || existing.slice(located.start, located.stop) !== block) {
    message = `AGENTS.md's JSKIT block differs from ${CATALOG} ${version}'s: ${FIX}`;
  }
  return {
    ok: message === null,
    applies: true,
    version,
    findings: message === null ? [] : [{ file: "AGENTS.md", rule: "agents/jskit-block", message }]
  };
}

function formatAgentsBlockReport(result) {
  if (!result.applies) return `JSKIT agent instructions: not checked, as package.json does not declare ${CATALOG}.`;
  const lines = result.findings.flatMap(({ file, rule, message }) => [`${file}  ${rule}  ${message}`, `  ${GUIDE}`]);
  lines.push(result.ok
    ? `JSKIT agent instructions: AGENTS.md carries the JSKIT block of ${CATALOG} ${result.version}.`
    : "JSKIT agent instructions: 1 error.");
  return lines.join("\n");
}

export { checkAgentsBlock, formatAgentsBlockReport, formatAgentsBlockWrite, writeAgentsBlock };
