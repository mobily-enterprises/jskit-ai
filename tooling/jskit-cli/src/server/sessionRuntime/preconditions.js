import {
  access,
  appendFile,
  mkdir
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  JSKIT_CLI_SHELL_COMMAND,
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
import {
  inspectReadyJskitAppRoot
} from "./appReadiness.js";

function jskitCommand(args = "") {
  return `${JSKIT_CLI_SHELL_COMMAND}${args ? ` ${args}` : ""}`;
}

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
      repairCommand: jskitCommand("session create")
    }),
    precondition: createPrecondition({
      id: "session_exists",
      ok: false,
      message: "Session state directory exists."
    })
  };
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertDependenciesInstalled(paths) {
  if (await pathExists(path.join(paths.sessionRoot, "steps", "dependencies_installed"))) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "dependencies_installed",
        ok: true,
        message: "Session worktree dependencies have been installed."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "dependencies_not_installed",
      message: "Cannot start issue work until dependencies are installed in the session worktree.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id: "dependencies_installed",
      ok: false,
      message: "Session worktree dependencies have been installed."
    })
  };
}

async function assertReadyJskitApp(paths) {
  const root = paths.worktree || paths.targetRoot;
  const readiness = await inspectReadyJskitAppRoot(root);
  if (readiness.ok) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "ready_jskit_app",
        ok: true,
        message: "Session worktree has the required JSKIT app markers."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "app_setup_required",
      message: `Issue sessions require a ready JSKIT app. Missing: ${readiness.missing.join(", ")}.`,
      repairCommand: "Run the app setup flow before starting issue work."
    }),
    precondition: createPrecondition({
      id: "ready_jskit_app",
      ok: false,
      message: "Session worktree has the required JSKIT app markers."
    })
  };
}

async function assertActiveCycleExists(paths) {
  const activeCycle = await readTrimmedFile(path.join(paths.sessionRoot, "active_cycle"));
  if (/^\d+$/u.test(activeCycle)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "active_cycle_exists",
        ok: true,
        message: "Active cycle marker exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "active_cycle_missing",
      message: "Session active_cycle is missing or invalid."
    }),
    precondition: createPrecondition({
      id: "active_cycle_exists",
      ok: false,
      message: "Active cycle marker exists."
    })
  };
}

async function assertActiveCycleUserCheckPassed(paths) {
  const activeCycle = await readTrimmedFile(path.join(paths.sessionRoot, "active_cycle"));
  const receiptPath = path.join(paths.sessionRoot, "steps", `cycle_${activeCycle}`, "user_check_completed");
  if (await pathExists(receiptPath)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "active_cycle_user_check_passed",
        ok: true,
        message: "The active cycle user check has passed."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "user_check_not_passed",
      message: "Finalization cannot continue until the active cycle user check has passed.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step --user-check passed`)
    }),
    precondition: createPrecondition({
      id: "active_cycle_user_check_passed",
      ok: false,
      message: "The active cycle user check has passed."
    })
  };
}

async function assertAcceptedChangesCommitted(paths) {
  const receiptPath = path.join(paths.sessionRoot, "steps", "changes_committed");
  if (await pathExists(receiptPath)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "accepted_changes_committed",
        ok: true,
        message: "Accepted changes have been committed."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "accepted_changes_not_committed",
      message: "Accepted changes must be committed before app memory and finalization steps continue.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id: "accepted_changes_committed",
      ok: false,
      message: "Accepted changes have been committed."
    })
  };
}

async function assertActiveCycleStepReceipt(paths, {
  code,
  id,
  message,
  stepId
}) {
  const activeCycle = await readTrimmedFile(path.join(paths.sessionRoot, "active_cycle"));
  const receiptPath = path.join(paths.sessionRoot, "steps", `cycle_${activeCycle}`, stepId);
  if (await pathExists(receiptPath)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id,
        ok: true,
        message
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code,
      message,
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id,
      ok: false,
      message
    })
  };
}

async function assertAutomatedChecksPassed(paths) {
  return assertActiveCycleStepReceipt(paths, {
    code: "automated_checks_not_passed",
    id: "automated_checks_passed",
    message: "Automated checks have passed.",
    stepId: "automated_checks_run"
  });
}

async function assertDeepUiCheckSatisfied(paths) {
  return assertActiveCycleStepReceipt(paths, {
    code: "deep_ui_check_not_satisfied",
    id: "deep_ui_check_satisfied",
    message: "Deep UI check is satisfied.",
    stepId: "deep_ui_check_run"
  });
}

async function assertIssueMetadataExists(paths) {
  const source = await readTextIfExists(path.join(paths.sessionRoot, "issue_metadata.json"));
  if (!source) {
    return {
      ok: false,
      error: createError({
        code: "issue_metadata_missing",
        message: "Cannot continue before issue_metadata.json records the issue category and UI impact.",
        repairCommand: jskitCommand(`session ${paths.sessionId} step --issue-details -`)
      }),
      precondition: createPrecondition({
        id: "issue_metadata_exists",
        ok: false,
        message: "Issue metadata records issue category and UI impact."
      })
    };
  }

  let metadata = null;
  try {
    metadata = JSON.parse(source);
  } catch {
    metadata = null;
  }
  const issueCategory = String(metadata?.issueCategory || "").trim().toLowerCase();
  const uiImpact = String(metadata?.uiImpact || "").trim().toLowerCase();
  const validIssueCategories = new Set(["client", "server", "client_server", "tooling", "unknown"]);
  const validUiImpacts = new Set(["none", "possible", "definite", "unknown"]);
  if (validIssueCategories.has(issueCategory) && validUiImpacts.has(uiImpact)) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "issue_metadata_exists",
        ok: true,
        message: "Issue metadata records issue category and UI impact."
      })
    };
  }

  return {
    ok: false,
    error: createError({
      code: "issue_metadata_invalid",
      message: "issue_metadata.json must include a valid issueCategory and uiImpact.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step --issue-details -`)
    }),
    precondition: createPrecondition({
      id: "issue_metadata_exists",
      ok: false,
      message: "Issue metadata records issue category and UI impact."
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
      repairCommand: jskitCommand(`session ${paths.sessionId} step --issue -`)
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
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id: "issue_url_exists",
      ok: false,
      message: "GitHub issue URL exists."
    })
  };
}

async function assertPlanTextExists(paths) {
  const activeCycle = await readTrimmedFile(path.join(paths.sessionRoot, "active_cycle"));
  const planPath = path.join(paths.sessionRoot, "cycles", `cycle_${activeCycle || "001"}`, "plan.md");
  const planText = await readTrimmedFile(planPath);
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
      message: "Cannot execute a plan before the active cycle plan exists.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step --plan -`)
    }),
    precondition: createPrecondition({
      id: "plan_text_exists",
      ok: false,
      message: "Plan text exists."
    })
  };
}

async function assertIssueDetailsExists(paths) {
  const issueDetails = await readTrimmedFile(path.join(paths.sessionRoot, "issue_details.md"));
  if (issueDetails) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "issue_details_exists",
        ok: true,
        message: "Issue details exist."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "issue_details_missing",
      message: "Cannot create a plan before issue_details.md exists.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step --issue-details -`)
    }),
    precondition: createPrecondition({
      id: "issue_details_exists",
      ok: false,
      message: "Issue details exist."
    })
  };
}

async function assertBlueprintUpdateSatisfied(paths) {
  if (await pathExists(path.join(paths.sessionRoot, "steps", "blueprint_updated"))) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "blueprint_update_satisfied",
        ok: true,
        message: "Blueprint update step is complete."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "blueprint_update_missing",
      message: "Cannot continue before the blueprint update step is complete.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id: "blueprint_update_satisfied",
      ok: false,
      message: "Blueprint update step is complete."
    })
  };
}

async function assertFinalReportExists(paths) {
  if (await pathExists(path.join(paths.sessionRoot, "final_report.md"))) {
    return {
      ok: true,
      precondition: createPrecondition({
        id: "final_report_exists",
        ok: true,
        message: "Final report exists."
      })
    };
  }
  return {
    ok: false,
    error: createError({
      code: "final_report_missing",
      message: "Cannot publish the PR before final_report.md exists.",
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
    }),
    precondition: createPrecondition({
      id: "final_report_exists",
      ok: false,
      message: "Final report exists."
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
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
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
      repairCommand: jskitCommand(`session ${paths.sessionId} step`)
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
  assertAcceptedChangesCommitted,
  assertActiveCycleExists,
  assertActiveCycleUserCheckPassed,
  assertBlueprintUpdateSatisfied,
  assertDeepUiCheckSatisfied,
  assertDependenciesInstalled,
  assertFinalReportExists,
  assertGhAuth,
  assertGitCurrentBranch,
  assertGitRepository,
  assertGithubOrigin,
  assertIssueMetadataExists,
  assertIssueTextExists,
  assertIssueUrlExists,
  assertAutomatedChecksPassed,
  assertIssueDetailsExists,
  assertPlanTextExists,
  assertPrUrlExists,
  assertReadyJskitApp,
  assertSessionExists,
  assertTargetRootWritable,
  assertWorktreeExists,
  ensureStudioGitExclude,
  hasWorktree
};
