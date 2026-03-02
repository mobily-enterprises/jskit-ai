import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function loadJson(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  return JSON.parse(source);
}

function buildKey(dup) {
  const format = String(dup?.format || "");
  const lines = Number(dup?.lines || 0);
  const tokens = Number(dup?.tokens || 0);
  const fragment = String(dup?.fragment || "");
  const hash = createHash("sha1").update(`${format}|${lines}|${tokens}|${fragment}`).digest("hex");
  return `${format}:${lines}:${tokens}:${hash}`;
}

function buildCounts(duplicates) {
  const counts = new Map();
  for (const dup of duplicates) {
    const key = buildKey(dup);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function usage() {
  console.error("Usage: node scripts/ci/check-duplication.mjs <report.json> <baseline.json>");
}

const [reportPath, baselinePath] = process.argv.slice(2);
if (!reportPath || !baselinePath) {
  usage();
  process.exit(2);
}

if (!fs.existsSync(reportPath)) {
  console.error(`Duplication report not found: ${reportPath}`);
  process.exit(2);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Duplication baseline not found: ${baselinePath}`);
  console.error("Generate it with: npx jscpd --config .jscpd.json --reporters json --output .jscpd && cp .jscpd/jscpd-report.json .jscpd/baseline.json");
  process.exit(2);
}

const report = loadJson(reportPath);
const baseline = loadJson(baselinePath);

const reportDuplicates = Array.isArray(report?.duplicates) ? report.duplicates : [];
const baselineDuplicates = Array.isArray(baseline?.duplicates) ? baseline.duplicates : [];

const baselineCounts = buildCounts(baselineDuplicates);
const reportCounts = buildCounts(reportDuplicates);

let newPairCount = 0;
const newPairs = [];
const seenCounts = new Map();

for (const dup of reportDuplicates) {
  const key = buildKey(dup);
  const seen = (seenCounts.get(key) || 0) + 1;
  seenCounts.set(key, seen);
  const allowed = baselineCounts.get(key) || 0;
  if (seen > allowed) {
    newPairCount += 1;
    if (newPairs.length < 20) {
      newPairs.push(dup);
    }
  }
}

if (newPairCount > 0) {
  console.error(`Found ${newPairCount} new duplicated fragment pair(s) beyond baseline.`);
  console.error("Sample new duplicates:");
  for (const dup of newPairs) {
    const first = dup?.firstFile?.name ? `${dup.firstFile.name}:${dup.firstFile.start}-${dup.firstFile.end}` : "unknown";
    const second = dup?.secondFile?.name ? `${dup.secondFile.name}:${dup.secondFile.start}-${dup.secondFile.end}` : "unknown";
    console.error(`- ${dup.format || "unknown"} (${dup.lines || "?"} lines, ${dup.tokens || "?"} tokens): ${first} <-> ${second}`);
  }
  process.exit(1);
}

// Also guard against baseline drift being missing entries when report shrinks.
const baselineTotal = baselineDuplicates.length;
const reportTotal = reportDuplicates.length;
console.log(`Duplication check passed. Baseline pairs: ${baselineTotal}, current pairs: ${reportTotal}.`);
