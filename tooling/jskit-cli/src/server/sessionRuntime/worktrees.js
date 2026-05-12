import path from "node:path";
import {
  runGit
} from "./io.js";

function parseGitWorktreeList(output = "") {
  return String(output || "")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()))
    .filter(Boolean);
}

async function hasWorktree(paths = {}) {
  if (!paths.targetRoot || !paths.worktree) {
    return false;
  }
  const result = await runGit(paths.targetRoot, ["worktree", "list", "--porcelain"], {
    timeout: 10000
  });
  if (!result.ok) {
    return false;
  }
  const expectedWorktree = path.resolve(paths.worktree);
  return parseGitWorktreeList(result.stdout).includes(expectedWorktree);
}

export {
  hasWorktree,
  parseGitWorktreeList
};
