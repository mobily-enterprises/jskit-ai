import path from "node:path";
import { fileURLToPath } from "node:url";

// The single declaration of what scripts/build-agent-docs.mjs generates; the
// generated-files check snapshots exactly these paths.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_DOCS_ROOT = path.join(REPO_ROOT, "packages", "agent-docs");
const REFERENCE_AUTOGEN_ROOT = path.join(AGENT_DOCS_ROOT, "reference", "autogen");
const GUIDE_AGENT_ROOT = path.join(AGENT_DOCS_ROOT, "guide", "agent");
const PUBLIC_PATTERN_ROOT = path.join(AGENT_DOCS_ROOT, "site", "patterns");
const JSKIT_SKILL_REFERENCES_ROOT = path.join(AGENT_DOCS_ROOT, "skills", "jskit", "references");
const JSKIT_SKILL_PATTERN_INDEX_PATH = path.join(JSKIT_SKILL_REFERENCES_ROOT, "pattern-index.md");
const JSKIT_SKILL_PATTERNS_ROOT = path.join(JSKIT_SKILL_REFERENCES_ROOT, "patterns");
const HEURISTICS_SOURCE_ROOT = path.join(AGENT_DOCS_ROOT, "heuristics");
const JSKIT_SKILL_HEURISTICS_ROOT = path.join(JSKIT_SKILL_REFERENCES_ROOT, "heuristics");
// Guide source (relative to site/guide) -> bundled skill reference file name.
const JSKIT_SKILL_GUIDES = Object.freeze({
  "app-setup/existing-application-migration.md": "existing-application-migration.md",
  "app-setup/multi-homing.md": "multi-homing.md",
  "framework/application-operations.md": "app-operations.md",
  "framework/crud-operations.md": "crud-operations.md",
  "framework/material-3.md": "material-3.md",
  "framework/ui-operations.md": "ui-operations.md"
});
const AGENT_DOCS_OUTPUT_PATHS = Object.freeze([
  REFERENCE_AUTOGEN_ROOT,
  GUIDE_AGENT_ROOT,
  PUBLIC_PATTERN_ROOT,
  JSKIT_SKILL_PATTERN_INDEX_PATH,
  JSKIT_SKILL_PATTERNS_ROOT,
  JSKIT_SKILL_HEURISTICS_ROOT,
  ...Object.values(JSKIT_SKILL_GUIDES).map((targetFile) => path.join(JSKIT_SKILL_REFERENCES_ROOT, targetFile))
]);

export {
  AGENT_DOCS_OUTPUT_PATHS,
  AGENT_DOCS_ROOT,
  GUIDE_AGENT_ROOT,
  HEURISTICS_SOURCE_ROOT,
  JSKIT_SKILL_GUIDES,
  JSKIT_SKILL_HEURISTICS_ROOT,
  JSKIT_SKILL_PATTERN_INDEX_PATH,
  JSKIT_SKILL_PATTERNS_ROOT,
  JSKIT_SKILL_REFERENCES_ROOT,
  PUBLIC_PATTERN_ROOT,
  REFERENCE_AUTOGEN_ROOT,
  REPO_ROOT
};
