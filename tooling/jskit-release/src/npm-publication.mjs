import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, readdir, readFile, readlink } from "node:fs/promises";
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

async function archiveManifest(file) {
  let contents = "";
  await list({
    file, strict: true,
    onReadEntry(entry) {
      if (entry.path.replace(/^\.\//u, "") !== "package/package.json") return entry.resume();
      entry.on("data", chunk => { contents += chunk.toString("utf8"); });
    }
  });
  try { return JSON.parse(contents); } catch { throw new Error(`${file}: package archive has no readable package.json.`); }
}

// A package whose published artifact is not plain `npm pack` output declares
// `jskitRelease.pack`: a command run in the package directory that prints the
// tarball path (or JSON {"tarball": path}) as its last stdout line. Its other
// output is forwarded to stderr.
async function runPackCommand(record, env) {
  const command = String(record.packageJson.jskitRelease?.pack || "");
  const output = await new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: record.dir, env, shell: true, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout)
      : reject(new Error(`${record.name}: pack command \`${command}\` failed (code=${code}).`)));
  });
  const line = output.trim().split("\n").at(-1)?.trim() || "";
  let tarball = line;
  try {
    const value = JSON.parse(line);
    tarball = typeof value === "string" ? value : value?.tarball;
  } catch { /* A plain path. */ }
  if (!tarball) throw new Error(`${record.name}: pack command \`${command}\` printed no tarball path.`);
  return path.resolve(record.dir, tarball);
}

// Directory snapshots invalidate only invocation-local pack reuse. Equality with
// npm still comes from the actual package archive, never this source snapshot.
async function snapshotFiles(root, relative = "", files = new Map()) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) await snapshotFiles(root, name, files);
    else {
      const file = path.join(root, name);
      const info = await lstat(file);
      files.set(name, entry.isSymbolicLink()
        ? `link:${await readlink(file)}`
        : `${info.mode & 0o7777}:${createHash("sha512").update(await readFile(file)).digest("base64")}`);
    }
  }
  return files;
}

function sameSnapshot(left, right) {
  return left.size === right.size && [...left].every(([name, value]) => right.get(name) === value);
}

function createPublicationInspection({ directory, registry, configPath = "", env = process.env }) {
  const registryArgs = ["--registry", registry, "--workspaces=false", "--cache", path.join(directory, "npm-cache"), "--offline=false"];
  if (configPath) registryArgs.push("--userconfig", configPath);
  const metadata = new Map();
  const published = new Map();
  const candidates = new Map();
  const stats = { packed: 0, lookups: 0, downloaded: 0, packReused: 0, metadataReused: 0, downloadReused: 0, packMs: 0, lookupMs: 0, downloadMs: 0 };

  async function version(record, selectedVersion = record.packageJson.version) {
    const spec = `${record.name}@${selectedVersion}`;
    if (metadata.has(spec)) { stats.metadataReused++; return metadata.get(spec); }
    stats.lookups++;
    const started = performance.now();
    let value = await npmJson(["view", spec, "--json", "--prefer-online", ...registryArgs], {
      cwd: record.dir, env, allowMissing: true
    });
    stats.lookupMs += performance.now() - started;
    if (Array.isArray(value) && value.length === 1) [value] = value;
    if (value !== null && (value?.name !== record.name || value?.version !== selectedVersion || !value?.dist?.integrity || !value?.dist?.tarball)) {
      throw new Error(`${spec}: registry returned invalid version metadata.`);
    }
    metadata.set(spec, value);
    return value;
  }

  async function versions(record) {
    stats.lookups++;
    const started = performance.now();
    const value = await npmJson(["view", record.name, "--json", "--prefer-online", ...registryArgs], {
      cwd: record.dir, env, allowMissing: true
    });
    stats.lookupMs += performance.now() - started;
    const result = value === null ? [] : value.versions;
    if (!Array.isArray(result) || result.some(item => typeof item !== "string" || !/^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(item))) {
      throw new Error(`${record.name}: registry returned invalid version history.`);
    }
    // The response carries a mutable tag's version, but reuse is keyed by its
    // exact immutable identity. Current versions not in that response are read
    // explicitly by version(); latest is never the comparison baseline.
    if (value !== null) {
      if (value.name !== record.name || !result.includes(value.version) || !value.dist?.integrity || !value.dist?.tarball) {
        throw new Error(`${record.name}: registry returned invalid package metadata.`);
      }
      metadata.set(`${record.name}@${value.version}`, value);
    }
    return result;
  }

  function packedRecord(packed, record, destination) {
    const candidate = packed?.[0];
    if (packed?.length !== 1 || candidate?.name !== record.name || candidate?.version !== record.packageJson.version ||
        !candidate.filename || path.basename(candidate.filename) !== candidate.filename) {
      throw new Error(`${record.name}@${record.packageJson.version}: npm pack returned an unexpected package.`);
    }
    return path.join(destination, candidate.filename);
  }

  async function pack(record) {
    const snapshot = await snapshotFiles(record.dir);
    const previous = candidates.get(record.dir);
    if (previous && sameSnapshot(previous.snapshot, snapshot)) { stats.packReused++; return previous.tarball; }
    const destination = await mkdtemp(path.join(directory, "candidate-"));
    const started = performance.now();
    let tarball;
    if (record.packageJson.jskitRelease?.pack) {
      const built = await runPackCommand(record, env);
      const manifest = await archiveManifest(built);
      tarball = packedRecord([{ name: manifest.name, version: manifest.version, filename: path.basename(built) }], record, destination);
      await copyFile(built, tarball);
    } else {
      const packed = await npmJson(["pack", "--json", "--pack-destination", destination, ...registryArgs], { cwd: record.dir, env });
      tarball = packedRecord(packed, record, destination);
    }
    stats.packMs += performance.now() - started;
    stats.packed++;
    candidates.set(record.dir, { snapshot: await snapshotFiles(record.dir), tarball });
    return tarball;
  }

  async function compare(record, tarball) {
    const spec = `${record.name}@${record.packageJson.version}`;
    const value = await version(record);
    if (value === null) return { state: "publish", difference: "" };
    if (matchesIntegrity(await readFile(tarball), value.dist.integrity)) return { state: "skip", difference: "" };
    let baseline = published.get(spec);
    if (!baseline) {
      const destination = await mkdtemp(path.join(directory, "published-"));
      const started = performance.now();
      const downloaded = await npmJson([
        "pack", value.dist.tarball, "--json", "--ignore-scripts", "--prefer-online",
        "--pack-destination", destination, ...registryArgs
      ], { cwd: record.dir, env });
      const file = packedRecord(downloaded, record, destination);
      if (!matchesIntegrity(await readFile(file), value.dist.integrity)) {
        throw new Error(`${spec}: downloaded tarball does not match registry integrity.`);
      }
      baseline = await archiveContents(file);
      published.set(spec, baseline);
      stats.downloadMs += performance.now() - started;
      stats.downloaded++;
    } else stats.downloadReused++;
    const candidate = await archiveContents(tarball);
    const difference = [...new Set([...candidate.keys(), ...baseline.keys()])].sort()
      .find(name => JSON.stringify(candidate.get(name)) !== JSON.stringify(baseline.get(name))) || "";
    return { state: difference ? "conflict" : "skip", difference };
  }

  return { version, versions, pack, compare, stats };
}

async function planPublication(records, options) {
  const inspection = options.inspection || createPublicationInspection(options);
  const plan = [];
  for (const record of records) {
    const tarball = await inspection.pack(record);
    const { state, difference } = await inspection.compare(record, tarball);
    const { name, version } = record.packageJson;
    if (state === "conflict") throw new Error(`${name}@${version}: published contents differ at ${difference}. Prepare a new version.`);
    plan.push({ name, version, tarball, state });
    if (options.report !== false) process.stdout.write(`${state === "skip" ? "Skip matching release" : "Publish new release"}: ${name}@${version}\n`);
  }
  return plan;
}

export { createPublicationInspection, planPublication, snapshotFiles };
