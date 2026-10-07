import { appendFile, cp, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
// ONNX ModelProto metadata_props is field 14 (StringStringEntryProto).
// Append metadata only; the pinned source graph and weights remain byte-for-byte.
function protobufField(number, bytes) {
  const length = [];
  let remaining = bytes.length;
  while (remaining > 127) { length.push((remaining & 127) | 128); remaining = Math.floor(remaining / 128); }
  return Buffer.concat([Buffer.from([number * 8 + 2, ...length, remaining]), bytes]);
}
for (const [relative, entries] of Object.entries(manifest.onnxMetadata || {})) {
  const target = contained(stagedRoot, relative);
  if (!relative.endsWith(".onnx") || !entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("ONNX metadata must map model paths to string entries.");
  }
  const fields = Object.entries(entries).map(([key, value]) => {
    if (!key || typeof value !== "string") throw new Error("ONNX metadata keys and values must be strings.");
    return protobufField(14, Buffer.concat([protobufField(1, Buffer.from(key)), protobufField(2, Buffer.from(value))]));
  });
  if (!(await lstat(target)).isFile()) throw new Error("ONNX metadata requires a staged regular model file.");
  const physicalRoot = await realpath(stagedRoot);
  if (!(await realpath(target)).startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error("ONNX metadata must stay inside its staged pack.");
  }
  await appendFile(target, Buffer.concat(fields));
}
for (const [relative, content] of Object.entries(manifest.textFiles || {})) {
  if (typeof content !== "string") throw new Error("Model configuration files must contain text.");
  const target = contained(stagedRoot, relative);
  const physicalRoot = await realpath(stagedRoot);
  let parent = path.dirname(target);
  let physicalParent;
  while (!physicalParent) {
    try { physicalParent = await realpath(parent); }
    catch (error) { if (error.code !== "ENOENT") throw error; parent = path.dirname(parent); }
  }
  if (physicalParent !== physicalRoot && !physicalParent.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error("Model configuration files must stay inside their staged pack.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { flag: "wx" });
}
await writeFile(path.join(stagedRoot, "speech.json"), JSON.stringify(manifest.configuration || {}, null, 2) + "\n");
