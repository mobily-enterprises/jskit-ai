import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { list } from "tar";

const execute = promisify(execFile);

async function npmJson(args, { cwd, env = process.env, allowMissing = false } = {}) {
  let stdout;
  try {
    ({ stdout } = await execute("npm", args, {
      cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000
    }));
  } catch (error) {
    let detail;
    try { detail = JSON.parse(error.stdout || ""); } catch { /* npm did not return JSON. */ }
    if (allowMissing && error.code === 1 && detail?.error?.code === "E404") return null;
    throw new Error(`npm ${args[0]} failed (${detail?.error?.code || error.code}). Registry state is unknown.`, { cause: error });
  }
  try {
    const value = JSON.parse(stdout);
    if (value === null) throw new Error("Missing JSON value.");
    return value;
  }
  catch { throw new Error(`npm ${args[0]} returned invalid JSON. Registry state is unknown.`); }
}

function matchesIntegrity(bytes, integrity) {
  for (const algorithm of ["sha512", "sha384", "sha256", "sha1"]) {
    const hashes = String(integrity || "").split(/\s+/u)
      .filter(value => value.startsWith(`${algorithm}-`))
      .map(value => value.slice(algorithm.length + 1));
    if (hashes.length) {
      const actual = createHash(algorithm).update(bytes).digest("base64");
      return hashes.includes(actual);
    }
  }
  throw new Error("Registry metadata has no supported tarball integrity hash.");
}

async function archiveContents(file) {
  const contents = new Map();
  let invalid = "";
  await list({
    file, strict: true,
    onReadEntry(entry) {
      if (entry.type === "Directory") return;
      const name = entry.path.replace(/^\.\//u, "");
      if (!name.startsWith("package/") || name.split("/").includes("..") || contents.has(name)) {
        invalid = `Invalid or duplicate package archive path: ${name}`;
        return;
      }
      const type = entry.type === "OldFile" ? "File" : entry.type;
      if (!["File", "SymbolicLink", "Link"].includes(type)) {
        invalid = `Unsupported package archive entry: ${name} (${type})`;
        return;
      }
      const record = { type, mode: entry.mode & 0o7777, link: entry.linkpath || "", hash: "" };
      contents.set(name, record);
      const hash = createHash("sha512");
      entry.on("data", chunk => hash.update(chunk));
      entry.on("end", () => { record.hash = hash.digest("base64"); });
    }
  });
  if (invalid) throw new Error(invalid);
  if (!contents.has("package/package.json")) throw new Error("Package archive has no package.json.");
  return contents;
}

async function differingArchivePath(left, right) {
  const candidate = await archiveContents(left);
  const published = await archiveContents(right);
  for (const name of [...new Set([...candidate.keys(), ...published.keys()])].sort()) {
    if (JSON.stringify(candidate.get(name)) !== JSON.stringify(published.get(name))) return name;
  }
  return "";
}

async function planPublication(records, { directory, registry, configPath = "", env = process.env }) {
  const registryArgs = ["--registry", registry, "--workspaces=false"];
  if (configPath) registryArgs.push("--userconfig", configPath);
  const plan = [];
  for (const [index, record] of records.entries()) {
    const name = record.packageJson.name;
    const version = record.packageJson.version;
    const spec = `${name}@${version}`;
    const destination = path.join(directory, String(index));
    await mkdir(destination);
    const packed = await npmJson(["pack", "--json", "--pack-destination", destination, ...registryArgs], { cwd: record.dir, env });
    const candidate = packed?.[0];
    if (packed?.length !== 1 || candidate?.name !== name || candidate?.version !== version ||
        path.basename(candidate.filename || "") !== candidate.filename) {
      throw new Error(`${spec}: npm pack returned an unexpected package.`);
    }
    const tarball = path.join(destination, candidate.filename);
    const bytes = await readFile(tarball);
    let metadata = await npmJson(["view", spec, "--json", "--prefer-online", ...registryArgs], {
      cwd: record.dir, env, allowMissing: true
    });
    if (Array.isArray(metadata) && metadata.length === 1) [metadata] = metadata;
    let state = "publish";
    if (metadata !== null) {
      if (metadata?.name !== name || metadata?.version !== version || !metadata?.dist?.integrity) {
        throw new Error(`${spec}: registry returned invalid version metadata.`);
      }
      if (!matchesIntegrity(bytes, metadata.dist.integrity)) {
        const publishedDirectory = path.join(destination, "published");
        await mkdir(publishedDirectory);
        const downloaded = await npmJson([
          "pack", spec, "--json", "--ignore-scripts", "--prefer-online",
          "--pack-destination", publishedDirectory, ...registryArgs
        ], { cwd: record.dir, env });
        const archive = downloaded?.[0];
        if (downloaded?.length !== 1 || archive?.name !== name || archive?.version !== version ||
            path.basename(archive.filename || "") !== archive.filename) {
          throw new Error(`${spec}: npm downloaded an unexpected package.`);
        }
        const publishedTarball = path.join(publishedDirectory, archive.filename);
        if (!matchesIntegrity(await readFile(publishedTarball), metadata.dist.integrity)) {
          throw new Error(`${spec}: downloaded tarball does not match registry integrity.`);
        }
        const difference = await differingArchivePath(tarball, publishedTarball);
        if (difference) throw new Error(`${spec}: published contents differ at ${difference}. Prepare a new version.`);
      }
      state = "skip";
    }
    plan.push({ name, version, tarball, state });
    process.stdout.write(`${state === "skip" ? "Skip matching release" : "Publish new release"}: ${spec}\n`);
  }
  return plan;
}

export { planPublication };
