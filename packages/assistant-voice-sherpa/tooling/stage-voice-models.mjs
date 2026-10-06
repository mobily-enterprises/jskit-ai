import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [manifestPath, extractedRoot, stagedRoot] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
function contained(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error("Model file mappings must stay inside their pack.");
  }
  return path.join(root, relative);
}
for (const model of manifest.models) {
  if (!model.files || !Object.keys(model.files).length) throw new Error(`Model ${model.id} requires explicit file mappings.`);
  for (const [source, destination] of Object.entries(model.files)) {
    const target = contained(stagedRoot, destination);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(contained(extractedRoot, source), target, { recursive: true, errorOnExist: true, force: false });
  }
}
await writeFile(path.join(stagedRoot, "speech.json"), JSON.stringify(manifest.configuration || {}, null, 2) + "\n");
