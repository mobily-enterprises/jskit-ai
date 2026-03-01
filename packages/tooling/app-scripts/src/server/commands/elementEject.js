import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  loadSourceContext,
  parseFlagArgs,
  resolveRequiredString,
  resolveTargetPath
} from "./elementCommon.js";

function buildSourceHeader({ packageName, packageVersion, sourceSpecifier }) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return [
    `<!-- EJECTED FROM: ${packageName}@${packageVersion} -->`,
    `<!-- SOURCE: ${sourceSpecifier} -->`,
    `<!-- DATE: ${dateStamp} -->`,
    ""
  ].join("\n");
}

async function runElementEjectCommand({ appRoot, args = [] }) {
  const parsedArgs = parseFlagArgs(args);
  const sourceSpecifier = resolveRequiredString(parsedArgs.source, "source");
  const targetPath = resolveTargetPath(appRoot, resolveRequiredString(parsedArgs.target, "target"));
  const force = Boolean(parsedArgs.force);

  if (!force && existsSync(targetPath)) {
    throw new Error(`Refusing to overwrite existing file: ${path.relative(appRoot, targetPath)} (pass --force to overwrite).`);
  }

  const sourceContext = await loadSourceContext({
    appRoot,
    sourceSpecifier
  });
  const sourceHeader = buildSourceHeader({
    packageName: sourceContext.packageName,
    packageVersion: sourceContext.packageVersion,
    sourceSpecifier
  });

  await mkdir(path.dirname(targetPath), {
    recursive: true
  });
  await writeFile(targetPath, `${sourceHeader}${sourceContext.sourceText}`, "utf8");

  return {
    sourceSpecifier,
    targetPath,
    packageName: sourceContext.packageName,
    packageVersion: sourceContext.packageVersion
  };
}

export { runElementEjectCommand };
