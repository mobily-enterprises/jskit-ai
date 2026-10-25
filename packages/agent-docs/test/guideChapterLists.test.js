import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const GUIDE_ROOT = path.join(SITE_ROOT, "guide");

async function guideChapterLinks() {
  const links = [];
  for (const section of await readdir(GUIDE_ROOT, { withFileTypes: true })) {
    if (!section.isDirectory()) {
      continue;
    }
    for (const file of await readdir(path.join(GUIDE_ROOT, section.name))) {
      if (file.endsWith(".md")) {
        links.push(`/guide/${section.name}/${file.slice(0, -".md".length)}`);
      }
    }
  }
  return links.sort();
}

function listedGuideLinks(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

test("the guide index and sidebar list every guide chapter exactly once", async () => {
  const chapters = await guideChapterLinks();
  const sidebar = await readFile(path.join(SITE_ROOT, ".vitepress", "config.mjs"), "utf8");
  const guideIndex = await readFile(path.join(GUIDE_ROOT, "index.md"), "utf8");

  assert.deepEqual(listedGuideLinks(sidebar, /link: "(\/guide\/[^"]+\/[^"]+)"/gu), chapters);
  assert.deepEqual(listedGuideLinks(guideIndex, /\]\((\/guide\/[^)]+\/[^)]+)\)/gu), chapters);
});
