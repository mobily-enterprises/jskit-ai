import {
  access,
  appendFile,
  mkdir
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  SESSION_STATE_RELATIVE_PATH
} from "./constants.js";
import {
  createError,
  createPrecondition
} from "./responses.js";
import {
  readTextIfExists,
  readTrimmedFile,
  runCommand,
  runGit
} from "./io.js";
import {
  resolveExistingSessionRoot
} from "./paths.js";
import {
  hasWorktree
} from "./worktrees.js";

async function assertTargetRootWritable(targetRoot) {
  try {
    await access(targetRoot, fsConstants.R_OK | fsConstants.W_OK);
    return {
      ok: true,
      precondition: createPrecondition({
        id: "target_root_writable",
        ok: true,
        message: "Target root exists and is readable/writable."
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: createError({
        code: "target_root_not_writable",
        message: `Target root is not readable/writable: ${error?.message || error}`,
        repairCommand: `test -w ${targetRoot}`
      }),
      precondition: createPrecondition({
        id: "target_root_writable",
        ok: false,
        message: "Target root exists and is readable/writable."
      })
    };
  }
}

async function resolveGitCommonDirectory(targetRoot) {
  const result = await runGit(targetRoot, ["rev-parse", "--git-common-dir"]);
  if (!result.ok || !result.stdout) {
    return "";
  }
  return path.resolve(targetRoot, result.stdout);
}

async function assertGitRepository(targetRoot) {
  const result = await runGit(targetRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (result.ok && result.stdout === "true") {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "git_repository",
        ok: true,
        message: "Target root is inside a git work tree."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "git_repository_missing",
      message: "Target root is not inside a git work tree.",
      repairCommand: "git init"
    }),
    precondition: createPrecondition({
      id: "git_repository",
      ok: false,
      message: "Target root is inside a git work tree."
    })
  };
}

async function assertGitCurrentBranch(targetRoot) {
  const [branchResult, headResult] = await Promise.all([
    runGit(targetRoot, ["branch", "--show-current"]),
    runGit(targetRoot, ["rev-parse", "--verify", "HEAD"])
  ]);
  if (branchResult.ok && branchResult.stdout && headResult.ok) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "git_current_branch",
        ok: true,
        message: "Target repository has a named current branch with an initial commit."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "git_current_branch_missing",
      message: "Target repository does not have a named current branch with an initial commit.",
      repairCommand: "git checkout -b main && git add . && git commit -m \"Initial commit\""
    }),
    precondition: createPrecondition({
      id: "git_current_branch",
      ok: false,
      message: "Target repository has a named current branch with an initial commit."
    })
  };
}

async function assertGhAuth(targetRoot) {
  const result = await runCommand("gh", ["auth", "status"], {
    cwd: targetRoot,
    timeout: 15000
  });
  if (result.ok) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "github_auth",
        ok: true,
        message: "GitHub CLI is authenticated."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "github_auth_missing",
      message: "GitHub CLI is not authenticated.",
      repairCommand: "gh auth login"
    }),
    precondition: createPrecondition({
      id: "github_auth",
      ok: false,
      message: "GitHub CLI is authenticated."
    })
  };
}

async function assertGithubOrigin(targetRoot) {
  const result = await runGit(targetRoot, ["remote", "get-url", "origin"]);
  if (result.ok && /github\.com[:/]/u.test(result.stdout)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "github_origin",
        ok: true,
        message: "Origin remote points at GitHub."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "github_origin_missing",
      message: "Origin remote is missing or is not a GitHub remote.",
      repairCommand: "git remote add origin https://github.com/<owner>/<repo>.git"
    }),
    precondition: createPrecondition({
      id: "github_origin",
      ok: false,
      message: "Origin remote points at GitHub."
    })
  };
}

async function applyPreconditions(paths, checks = []) {
  const preconditions = [];
  for (const check of checks) {
    const result = await check();
    if (result?.precondition) {
      preconditions.push(result.precondition);
    }
    if (result?.ok !== true) {
      return {
        ok: false,
        error: result.error,
        preconditions
      };
    }
  }
  void paths;
  return {
    ok: true,
    preconditions
  };
}

async function ensureStudioGitExclude(targetRoot) {
  const gitCommonDirectory = await resolveGitCommonDirectory(targetRoot);
  if (!gitCommonDirectory) {
    return;
  }
  const excludePath = path.join(gitCommonDirectory, "info", "exclude");
  await mkdir(path.dirname(excludePath), { recursive: true });
  const current = await readTextIfExists(excludePath);
  const lines = current.split(/\r?\n/u).map((line) => line.trim());
  if (!lines.includes(`${SESSION_STATE_RELATIVE_PATH}/`)) {
    await appendFile(excludePath, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${SESSION_STATE_RELATIVE_PATH}/\n`, "utf8");
  }
}

async function assertSessionExists(paths) {
  const existing = await resolveExistingSessionRoot(paths);
  if (existing.root) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "session_exists",
        ok: true,
        message: "Session state directory exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "session_missing",
      message: `Session does not exist: ${paths.sessionId}`,
      repairCommand: "jskit session create"
    }),
    precondition: createPrecondition({
      id: "session_exists",
      ok: false,
      message: "Session state directory exists."
    })
  };
}

async function assertIssueTextExists(paths) {
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  if (issueText) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "issue_text_exists",
        ok: true,
        message: "Issue text exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "issue_text_missing",
      message: "Cannot create a GitHub issue before issue.md exists.",
      repairCommand: `jskit session ${paths.sessionId} step --issue -`
    }),
    precondition: createPrecondition({
      id: "issue_text_exists",
      ok: false,
      message: "Issue text exists."
    })
  };
}

async function assertIssueUrlExists(paths) {
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  if (issueUrl) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "issue_url_exists",
        ok: true,
        message: "GitHub issue URL exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "issue_url_missing",
      message: "Cannot create a plan before the GitHub issue exists.",
      repairCommand: `jskit session ${paths.sessionId} step`
    }),
    precondition: createPrecondition({
      id: "issue_url_exists",
      ok: false,
      message: "GitHub issue URL exists."
    })
  };
}

async function assertPlanTextExists(paths) {
  const planText = await readTrimmedFile(path.join(paths.sessionRoot, "plan.md"));
  if (planText) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "plan_text_exists",
        ok: true,
        message: "Plan text exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "plan_text_missing",
      message: "Cannot fine-tune a plan before plan.md exists.",
      repairCommand: `jskit session ${paths.sessionId} step --plan -`
    }),
    precondition: createPrecondition({
      id: "plan_text_exists",
      ok: false,
      message: "Plan text exists."
    })
  };
}

async function assertWorktreeExists(paths) {
  if (await hasWorktree(paths)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "worktree_exists",
        ok: true,
        message: "Session worktree exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "worktree_missing",
      message: "Session worktree does not exist.",
      repairCommand: `jskit session ${paths.sessionId} step`
    }),
    precondition: createPrecondition({
      id: "worktree_exists",
      ok: false,
      message: "Session worktree exists."
    })
  };
}

async function assertPrUrlExists(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  if (prUrl) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "pr_url_exists",
        ok: true,
        message: "PR URL exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "pr_url_missing",
      message: "Cannot merge before pr_url exists.",
      repairCommand: `jskit session ${paths.sessionId} step`
    }),
    precondition: createPrecondition({
      id: "pr_url_exists",
      ok: false,
      message: "PR URL exists."
    })
  };
}

export {
  applyPreconditions,
  assertGhAuth,
  assertGitCurrentBranch,
  assertGitRepository,
  assertGithubOrigin,
  assertIssueTextExists,
  assertIssueUrlExists,
  assertPlanTextExists,
  assertPrUrlExists,
  assertSessionExists,
  assertTargetRootWritable,
  assertWorktreeExists,
  ensureStudioGitExclude,
  hasWorktree
};
