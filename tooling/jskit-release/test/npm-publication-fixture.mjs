import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "tar";
import { runGenerators } from "../../../scripts/check-generated-files.mjs";

const realNpm = execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim();

// The JSKIT repository root supplies the generators its prepare command runs.
const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const releaseBin = fileURLToPath(new URL("../bin/jskit-release.mjs", import.meta.url));

async function publicationFixture(t, publisher = "genesis") {
  const directory = await mkdtemp(path.join(tmpdir(), "npm-publication-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = path.join(directory, "repo");
  const tools = path.join(directory, "tools");
  await mkdir(path.join(repo, "scripts"), { recursive: true });
  await mkdir(path.join(repo, "tooling"));
  await mkdir(tools);
  for (const file of ["agent-docs-outputs.mjs", "check-generated-files.mjs", "check-generated-reference-paths.mjs", "build-agent-docs.mjs"]) {
    await copyFile(path.join(sourceRoot, "scripts", file), path.join(repo, "scripts", file));
  }
  await symlink(path.join(sourceRoot, "node_modules"), path.join(repo, "node_modules"), "dir");
  await writeFile(path.join(repo, ".gitignore"), "node_modules\n");
  const packages = publisher === "genesis"
    ? [{ name: "genesis-compiler", dir: repo }, { name: "genesis-stack", dir: path.join(repo, "packages/genesis-stack") }]
    : [{ name: "@jskit-ai/a", dir: path.join(repo, "packages/a") }, { name: "@jskit-ai/b", dir: path.join(repo, "packages/b") }];
  if (publisher === "jskit") {
    await writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "release-fixture", private: true, workspaces: ["packages/*", "tooling/*"],
      jskitRelease: { prepare: "node ./scripts/check-generated-files.mjs --regenerate", nestedManifests: ["patterns", "examples"] } }) + "\n");
  }
  for (const [index, record] of packages.entries()) {
    await mkdir(record.dir, { recursive: true });
    record.packageJson = { name: record.name, version: "1.0.0", files: ["index.js"],
      ...(publisher === "jskit" && index === 1 ? { dependencies: { "@jskit-ai/a": "1.0.0" } } : {}),
      // Genesis shape: the root package reaches the second one only through `file:`.
      ...(publisher === "genesis" && index === 0 ? { devDependencies: { "genesis-stack": "file:packages/genesis-stack" } } : {}) };
    await writeFile(path.join(record.dir, "package.json"), JSON.stringify(record.packageJson) + "\n");
    await writeFile(path.join(record.dir, "index.js"), "export const value = 1;\n");
  }
  const catalogScripts = path.join(repo, "tooling/jskit-catalog/scripts");
  await mkdir(catalogScripts, { recursive: true });
  for (const file of ["build-catalog.mjs", "pattern-assets.mjs"]) {
    await copyFile(path.join(sourceRoot, "tooling/jskit-catalog/scripts", file), path.join(catalogScripts, file));
  }
  await mkdir(path.join(repo, "packages/kernel/shared"), { recursive: true });
  await mkdir(path.join(repo, "packages/agent-docs/site/guide"), { recursive: true });
  function regenerate() {
    runGenerators(repo, { quiet: true });
  }
  async function syncLockfile() {
    const lock = { name: "release-fixture", lockfileVersion: 3, packages: {} };
    for (const file of [path.join(repo, "package.json"), ...packages.map(record => path.join(record.dir, "package.json"))]) {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      lock.packages[path.relative(repo, path.dirname(file)).split(path.sep).join("/")] = Object.fromEntries(
        ["version", "dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
          .filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]])
      );
    }
    await writeFile(path.join(repo, "package-lock.json"), JSON.stringify(lock) + "\n");
  }
  if (publisher === "jskit") regenerate();
  await syncLockfile();
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "user.name", "Release test");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "Release fixture");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", path.join(directory, "origin.git")], { stdio: "pipe" });
  git("remote", "add", "origin", path.join(directory, "origin.git"));
  git("push", "origin", "main");
  const log = path.join(directory, "calls.jsonl");
  const registryFile = path.join(directory, "registry.json");
  const registry = {};
  await writeFile(registryFile, "{}");
  await writeFile(path.join(tools, "npm"), `#!${process.execPath}
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const config=args.includes('--userconfig')?args[args.indexOf('--userconfig')+1]:null;
const entry={args,cwd:process.cwd(),config};
if(config){entry.mode=fs.statSync(config).mode&0o777;entry.tokenPresent=Boolean(process.env.NPM_TOKEN);}
if(args[0]==='install'&&fs.existsSync('package-lock.json'))entry.lockKeys=Object.keys(JSON.parse(fs.readFileSync('package-lock.json','utf8')).packages||{});
if(args[0]==='publish')entry.integrity='sha512-'+crypto.createHash('sha512').update(fs.readFileSync(args[1])).digest('base64');
fs.appendFileSync(process.env.RELEASE_TEST_LOG,JSON.stringify(entry)+'\\n');
if(args[0]==='install'&&Number(process.env.RELEASE_TEST_INSTALL_FAILURES||0)>=fs.readFileSync(process.env.RELEASE_TEST_LOG,'utf8').trim().split('\\n').filter(line=>JSON.parse(line).args[0]==='install').length){
  console.error('npm error code ETARGET');process.exit(1);
}
if(process.env.RELEASE_TEST_FAIL===args[0]){
  console.log(JSON.stringify({error:{code:process.env.RELEASE_TEST_CODE||'E503'}}));process.exit(1);
}
const registry=JSON.parse(fs.readFileSync(process.env.RELEASE_TEST_REGISTRY,'utf8'));
if(args[0]==='view'){
  if(process.env.RELEASE_TEST_NULL_METADATA){console.log('null');process.exit(0);}
  if(!args[1].slice(1).includes('@')){
    const entries=Object.values(registry).filter(record=>record.name===args[1]);
    const versions=entries.map(record=>record.version).filter(version=>version!==process.env.RELEASE_TEST_HIDE_VERSION);
    if(!versions.length){console.log(JSON.stringify({error:{code:'E404'}}));process.exit(1);}
    const record=entries.at(-1);
    console.log(JSON.stringify({name:record.name,version:record.version,versions,dist:{integrity:record.integrity,tarball:record.tarball}}));
  }else{
    const record=registry[args[1]];
    if(!record){console.log(JSON.stringify({error:{code:'E404'}}));process.exit(1);}
    console.log(JSON.stringify({name:record.name,version:record.version,dist:{integrity:record.integrity,tarball:record.tarball}}));
  }
}else if(args[0]==='pack'){
  const destination=args[args.indexOf('--pack-destination')+1];
  const remote=args[1].startsWith('--')?null:Object.values(registry).find(record=>record.tarball===args[1]);
  if(remote){
    const filename=remote.name.replace('@','').replace('/','-')+'-'+remote.version+'.tgz';
    fs.copyFileSync(remote.file,path.join(destination,filename));
    console.log(JSON.stringify([{name:remote.name,version:remote.version,filename}]));
  }else{
    const result=spawnSync(${JSON.stringify(realNpm)},args,{encoding:'utf8'});
    process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status;
  }
}else if(args[0]==='publish'){
  const calls=fs.readFileSync(process.env.RELEASE_TEST_LOG,'utf8').trim().split('\\n').map(line=>JSON.parse(line));
  const number=calls.filter(call=>call.args[0]==='publish').length;
  if(process.env.RELEASE_TEST_FAIL_UPLOAD===String(number))process.exit(1);
  const metadata=JSON.parse(spawnSync('tar',['-xOf',args[1],'package/package.json'],{encoding:'utf8'}).stdout);
  const file=path.join(path.dirname(process.env.RELEASE_TEST_REGISTRY),metadata.name.replace('/','-')+'-'+metadata.version+'.tgz');
  fs.copyFileSync(args[1],file);
  registry[metadata.name+'@'+metadata.version]={name:metadata.name,version:metadata.version,file,integrity:entry.integrity,tarball:'https://registry.fixture.invalid/'+encodeURIComponent(metadata.name+'@'+metadata.version)+'.tgz'};
  fs.writeFileSync(process.env.RELEASE_TEST_REGISTRY,JSON.stringify(registry));
  console.log('published fixture');
}else if(args[0]==='install'){
  const lock={name:'release-fixture',lockfileVersion:3,packages:{}};
  const files=['package.json'];
  for(const root of ['packages','tooling'].filter(root=>fs.existsSync(root)))for(const name of fs.readdirSync(root)){
    const manifest=path.join(root,name,'package.json');if(fs.existsSync(manifest))files.push(manifest);
  }
  for(const file of files){
    const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
    const name=path.dirname(file)==='.'?'':path.dirname(file);
    lock.packages[name]=Object.fromEntries(['version','dependencies','devDependencies','peerDependencies','optionalDependencies'].filter(key=>manifest[key]!==undefined).map(key=>[key,manifest[key]]));
  }
  fs.writeFileSync('package-lock.json',JSON.stringify(lock)+'\\n');
}else console.log(args[0]==='whoami'?'release-fixture':'published fixture');
`, { mode: 0o755 });
  const fixtureEnv = { ...process.env, PATH: tools + path.delimiter + process.env.PATH, NPM_TOKEN: "fixture-token",
    RELEASE_TEST_LOG: log, RELEASE_TEST_REGISTRY: registryFile };
  return {
    repo, directory, git, packages, regenerate, syncLockfile, env: fixtureEnv,
    run(args, env = {}, cwd = repo) {
      return spawnSync(process.execPath, [releaseBin, ...args], {
        cwd, encoding: "utf8", env: { ...fixtureEnv, ...env }
      });
    },
    async addPackage(name, options = {}) {
      const shortName = name.split("/").at(-1);
      const dir = path.join(repo, shortName === "jskit-catalog" ? "tooling" : "packages", shortName);
      await mkdir(dir, { recursive: true });
      const record = { name, dir, packageJson: { name, version: "1.0.0", files: ["index.js"], ...options } };
      await writeFile(path.join(dir, "package.json"), JSON.stringify(record.packageJson) + "\n");
      await writeFile(path.join(dir, "index.js"), "export const value = 1;\n");
      packages.push(record);
      return packages.length - 1;
    },
    async published(index, { mtime, content, integrity, version } = {}) {
      const record = packages[index];
      const file = path.join(directory, `published-${index}-${version || record.packageJson.version}.tgz`);
      const source = path.join(record.dir, "index.js");
      const manifestPath = path.join(record.dir, "package.json");
      const original = await readFile(source);
      const originalManifest = await readFile(manifestPath);
      let manifest;
      try {
        if (content !== undefined) await writeFile(source, content);
        manifest = JSON.parse(originalManifest);
        if (version) { manifest.version = version; await writeFile(manifestPath, JSON.stringify(manifest) + "\n"); }
        const packed = JSON.parse(execFileSync(realNpm, ["pack", "--json", "--pack-destination", directory, "--workspaces=false"], { cwd: record.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
        if (mtime !== undefined) await create({ cwd: record.dir, file, prefix: "package", gzip: { level: 9 }, portable: true, mtime: new Date(mtime) }, packed.files.map(entry => entry.path));
        else await copyFile(path.join(directory, packed.filename), file);
        await rm(path.join(directory, packed.filename));
      } finally { await writeFile(source, original); await writeFile(manifestPath, originalManifest); }
      const spec = `${record.name}@${manifest.version}`;
      registry[spec] = { name: record.name, version: manifest.version, file, tarball: `https://registry.fixture.invalid/${encodeURIComponent(spec)}.tgz`,
        integrity: integrity || `sha512-${createHash("sha512").update(await readFile(file)).digest("base64")}` };
      await writeFile(registryFile, JSON.stringify(registry));
      return registry[spec].integrity;
    },
    async calls() {
      if (!existsSync(log)) return [];
      return (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    }
  };
}

export { publicationFixture };
