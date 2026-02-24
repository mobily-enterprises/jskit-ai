import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  loadSourceContext,
  normalizeNewlines,
  parseFlagArgs,
  resolveRequiredString,
  resolveTargetPath,
  stripEjectHeader
} from "./elementCommon.js";

function buildDiffPreview(sourceText, targetText, maxLines = 12) {
  const sourceLines = normalizeNewlines(sourceText).split("\n");
  const targetLines = normalizeNewlines(targetText).split("\n");
  const lineCount = Math.max(sourceLines.length, targetLines.length);
  const previews = [];

  for (let index = 0; index < lineCount; index += 1) {
    const sourceLine = sourceLines[index];
    const targetLine = targetLines[index];
    if (sourceLine === targetLine) {
      continue;
    }

    previews.push(`L${index + 1}`);
    previews.push(`- ${sourceLine == null ? "" : sourceLine}`);
    previews.push(`+ ${targetLine == null ? "" : targetLine}`);

    if (previews.length >= maxLines * 3) {
      break;
    }
  }

  return previews;
}

async function runElementDiffCommand({ appRoot, args = [] }) {
  const parsedArgs = parseFlagArgs(args);
  const sourceSpecifier = resolveRequiredString(parsedArgs.source, "source");
  const targetPath = resolveTargetPath(appRoot, resolveRequiredString(parsedArgs.target, "target"));
  const check = Boolean(parsedArgs.check);

  const sourceContext = await loadSourceContext({
    appRoot,
    sourceSpecifier
  });
  const targetRaw = await readFile(targetPath, "utf8");
  const sourceNormalized = normalizeNewlines(sourceContext.sourceText);
  const targetNormalized = stripEjectHeader(targetRaw);

  const drift = sourceNormalized !== targetNormalized;
  const preview = drift ? buildDiffPreview(sourceNormalized, targetNormalized) : [];

  return {
    sourceSpecifier,
    targetPath,
    drift,
    check,
    preview,
    packageName: sourceContext.packageName,
    packageVersion: sourceContext.packageVersion
  };
}

export { runElementDiffCommand };
