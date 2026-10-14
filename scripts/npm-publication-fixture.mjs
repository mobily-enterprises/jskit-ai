import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "tar";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

async function publicationFixture(t, publisher = "genesis") {
  const directory = await mkdtemp(path.join(tmpdir(), "npm-publication-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = path.join(directory, "repo");
  const tools = path.join(directory, "tools");
  await mkdir(path.join(repo, "scripts"), { recursive: true });
  await mkdir(path.join(repo, "tooling"));
  await mkdir(tools);
  for (const file of ["release-npm.mjs", "npm-publication.mjs"]) {
    await copyFile(path.join(sourceRoot, "scripts", file), path.join(repo, "scripts", file));
  }
  await symlink(path.join(sourceRoot, "node_modules"), path.join(repo, "node_modules"), "dir");
  await writeFile(path.join(repo, ".gitignore"), "node_modules\n");
  const packages = publisher === "genesis"
    ? [{ name: "genesis-compiler", dir: repo }, { name: "genesis-stack", dir: path.join(repo, "packages/genesis-stack") }]
    : [{ name: "@jskit-ai/a", dir: path.join(repo, "packages/a") }, { name: "@jskit-ai/b", dir: path.join(repo, "packages/b") }];
  if (publisher === "jskit") await writeFile(path.join(repo, "package.json"), '{"name":"release-fixture","private":true}\n');
  for (const [index, record] of packages.entries()) {
    await mkdir(record.dir, { recursive: true });
    record.packageJson = { name: record.name, version: "1.0.0", files: ["index.js"],
      ...(publisher === "jskit" && index === 1 ? { dependencies: { "@jskit-ai/a": "1.0.0" } } : {}) };
    await writeFile(path.join(record.dir, "package.json"), JSON.stringify(record.packageJson) + "\n");
    await writeFile(path.join(record.dir, "index.js"), "export const value = 1;\n");
  }
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "user.name", "Release test");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "Release fixture");
  execFileSync("git", ["init", "--bare", path.join(directory, "origin.git")], { stdio: "pipe" });
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
const tar=require(${JSON.stringify(path.join(sourceRoot, "node_modules/tar"))});
const args=process.argv.slice(2);
const config=args.includes('--userconfig')?args[args.indexOf('--userconfig')+1]:null;
const entry={args,cwd:process.cwd(),config};
if(config){entry.mode=fs.statSync(config).mode&0o777;entry.tokenPresent=Boolean(process.env.NPM_TOKEN);}
if(args[0]==='publish')entry.integrity='sha512-'+crypto.createHash('sha512').update(fs.readFileSync(args[1])).digest('base64');
fs.appendFileSync(process.env.RELEASE_TEST_LOG,JSON.stringify(entry)+'\\n');
if(process.env.RELEASE_TEST_FAIL===args[0]){
  console.log(JSON.stringify({error:{code:process.env.RELEASE_TEST_CODE||'E503'}}));process.exit(1);
}
const registry=JSON.parse(fs.readFileSync(process.env.RELEASE_TEST_REGISTRY,'utf8'));
if(args[0]==='view'){
  if(process.env.RELEASE_TEST_NULL_METADATA){console.log('null');process.exit(0);}
  const record=registry[args[1]];
  if(!record){console.log(JSON.stringify({error:{code:'E404'}}));process.exit(1);}
  console.log(JSON.stringify({name:record.name,version:'1.0.0',dist:{integrity:record.integrity}}));
}else if(args[0]==='pack'){
  (async()=>{
    const destination=args[args.indexOf('--pack-destination')+1];
    const remote=args[1].startsWith('--')?null:registry[args[1]];
    const manifest=remote?{name:remote.name,version:'1.0.0'}:JSON.parse(fs.readFileSync('package.json','utf8'));
    const filename=manifest.name.replace('@','').replace('/','-')+'-1.0.0.tgz';
    const file=path.join(destination,filename);
    if(remote)fs.copyFileSync(remote.file,file);
    else await tar.create({cwd:process.cwd(),file,prefix:'package',gzip:{level:9},portable:true,mtime:new Date(1000)},['package.json','index.js']);
    console.log(JSON.stringify([{name:manifest.name,version:manifest.version,filename}]));
  })().catch(error=>{console.error(error.message);process.exitCode=1;});
}else console.log(args[0]==='whoami'?'release-fixture':'published fixture');
`, { mode: 0o755 });
  return {
    repo, git, packages,
    run(args, env = {}) {
      return spawnSync(process.execPath, [path.join(repo, "scripts/release-npm.mjs"), ...args], {
        encoding: "utf8",
        env: { ...process.env, PATH: tools + path.delimiter + process.env.PATH, NPM_TOKEN: "fixture-token",
          RELEASE_TEST_LOG: log, RELEASE_TEST_REGISTRY: registryFile, ...env }
      });
    },
    async published(index, { mtime = 1000, content, integrity } = {}) {
      const record = packages[index];
      const file = path.join(directory, `published-${index}.tgz`);
      const source = path.join(record.dir, "index.js");
      const original = await readFile(source);
      try {
        if (content !== undefined) await writeFile(source, content);
        await create({ cwd: record.dir, file, prefix: "package", gzip: { level: 9 }, portable: true, mtime: new Date(mtime) }, ["package.json", "index.js"]);
      } finally { await writeFile(source, original); }
      registry[`${record.name}@1.0.0`] = { name: record.name, file,
        integrity: integrity || `sha512-${createHash("sha512").update(await readFile(file)).digest("base64")}` };
      await writeFile(registryFile, JSON.stringify(registry));
      return registry[`${record.name}@1.0.0`].integrity;
    },
    async calls() {
      if (!existsSync(log)) return [];
      return (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    }
  };
}

export { publicationFixture };
