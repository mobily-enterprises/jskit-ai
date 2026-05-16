import path from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_STATUS = Object.freeze({
  ABANDONED: "abandoned",
  BLOCKED: "blocked",
  FAILED: "failed",
  FINISHED: "finished",
  PENDING: "pending",
  RUNNING: "running",
  WAITING_FOR_USER: "waiting_for_user"
});

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-[a-z0-9]{4})?$/u;
const SESSION_STATE_RELATIVE_PATH = ".jskit/sessions";
const SESSION_WORKFLOW_VERSION = "7";
const DEPENDENCIES_INSTALL_RESULT_FILE = "dependencies_install_result";
const REVIEW_PASS_LIMIT = 0;
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const JSKIT_CLI_SHELL_COMMAND = "npx --no-install jskit";
const DEFAULT_NEXT_COMMAND_TEMPLATE = `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} next`;

const INPUT_NONE = Object.freeze({ type: "none" });
const USER_CHECK_INPUT = Object.freeze({
  label: "Choose user check result",
  name: "userCheck",
  options: Object.freeze([
    Object.freeze({ label: "Passed", value: "passed" }),
    Object.freeze({ label: "Failed", value: "failed" })
  ]),
  required: true,
  type: "choice"
});

function codexHandoff({
  promptActionLabel = "",
  promptIntroText = "",
  promptWaitingText = "",
  sendPrompt = false
} = {}) {
  return Object.freeze({
    mode: "inject_prompt",
    promptField: "prompt",
    ...(promptActionLabel ? { promptActionLabel } : {}),
    ...(promptIntroText ? { promptIntroText } : {}),
    ...(promptWaitingText ? { promptWaitingText } : {}),
    ...(sendPrompt ? { sendPrompt: true } : {})
  });
}

function stepAutomationFor({
  codex = undefined,
  id,
  kind,
  requiresExplicitRun = false
}) {
  if (requiresExplicitRun) {
    return Object.freeze({ mode: "manual" });
  }
  if (id === "dependencies_installed") {
    return Object.freeze({ mode: "terminal" });
  }
  if (kind === "automatic") {
    return Object.freeze({ mode: "manual" });
  }
  if (kind === "codex_prompt" && codex?.sendPrompt === true) {
    return Object.freeze({ mode: "codex_prompt" });
  }
  return Object.freeze({ mode: "manual" });
}

const ISSUE_DEFINITION_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Define issue",
  sendPrompt: true
});
const ISSUE_FILE_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Create issue file",
  sendPrompt: true
});
const PLAN_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Make plan",
  sendPrompt: true
});
const PLAN_EXECUTION_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Execute plan",
  sendPrompt: true
});
const REVIEW_EXECUTION_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Run review/deslop",
  sendPrompt: true
});
const RESOLVE_DESLOP_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Resolve review/deslop",
  sendPrompt: true
});
const DEEP_UI_CHECK_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Run deep UI check",
  sendPrompt: true
});
const AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Run automated checks",
  sendPrompt: true
});
const BLUEPRINT_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Update blueprint",
  sendPrompt: true
});
const PR_MERGE_PREP_CODEX_HANDOFF = codexHandoff({
  promptActionLabel: "Prepare PR merge",
  promptWaitingText: "Codex is preparing the PR for merge. Continue only when you decide the PR is ready.",
  sendPrompt: true
});

function defineStep({
  buttonLabel,
  codex = undefined,
  description,
  id,
  input = INPUT_NONE,
  kind = "automatic",
  label,
  nextCommandTemplate = DEFAULT_NEXT_COMMAND_TEMPLATE,
  preconditions = [],
  requiresExplicitRun = false,
  submitOptions = {},
  automation = undefined,
  utilityActions = [],
  displayGroupId = "",
  displayGroupLabel = ""
}) {
  const resolvedAutomation = automation || stepAutomationFor({
    codex,
    id,
    kind,
    requiresExplicitRun
  });
  return Object.freeze({
    automation: Object.freeze({ ...resolvedAutomation }),
    buttonLabel,
    codex,
    description,
    displayGroupId,
    displayGroupLabel,
    id,
    input,
    kind,
    label,
    nextCommandTemplate,
    preconditions: Object.freeze([...preconditions]),
    requiresExplicitRun,
    submitOptions: Object.freeze({ ...submitOptions }),
    utilityActions: Object.freeze([...utilityActions])
  });
}

const STEP_DEFINITIONS = Object.freeze([
  defineStep({
    buttonLabel: "Create session",
    description: "JSKIT creates the filesystem-backed session record.",
    id: "session_created",
    label: "Create session"
  }),
  defineStep({
    buttonLabel: "Create worktree",
    description: "JSKIT creates the isolated Git branch and session worktree where Codex will work.",
    id: "worktree_created",
    label: "Create worktree",
    preconditions: ["session_exists", "git_repository", "git_current_branch"]
  }),
  defineStep({
    buttonLabel: "Install dependencies",
    description: "JSKIT installs Node dependencies inside the session worktree before Codex starts.",
    id: "dependencies_installed",
    label: "Install dependencies",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Define issue",
    description: "User describes the requested change; Codex helps scope and define the issue in the terminal.",
    displayGroupId: "define_create_issue",
    displayGroupLabel: "Define issue and create file",
    id: "issue_prompt_rendered",
    input: Object.freeze({
      label: "What should change?",
      multiline: true,
      name: "prompt",
      placeholder: "Describe the feature, bug, or change request.",
      required: true,
      type: "text"
    }),
    kind: "human_input",
    label: "Define issue",
    nextCommandTemplate: DEFAULT_NEXT_COMMAND_TEMPLATE,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Create issue file",
    description: "JSKIT renders the issue-file prompt; Codex writes issue.md and issue_title for review.",
    displayGroupId: "define_create_issue",
    displayGroupLabel: "Define issue and create file",
    id: "issue_created",
    label: "Create issue file",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"],
    requiresExplicitRun: false
  }),
  defineStep({
    buttonLabel: "Create issue on GH",
    description: "JSKIT creates the GitHub issue from the reviewed issue files and records the issue metadata.",
    id: "issue_submitted",
    label: "Edit and submit issue",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists"],
    requiresExplicitRun: false
  }),
  defineStep({
    buttonLabel: "Make plan",
    codex: PLAN_CODEX_HANDOFF,
    description: "Codex writes the plan in the terminal; JSKIT records it when the user continues.",
    id: "plan_made",
    kind: "codex_prompt",
    label: "Make plan",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} next`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists"]
  }),
  defineStep({
    buttonLabel: "Execute plan",
    codex: PLAN_EXECUTION_CODEX_HANDOFF,
    description: "JSKIT sends the plan to Codex; Codex implements it; the user advances after reviewing completion.",
    id: "plan_executed",
    kind: "codex_prompt",
    label: "Execute plan",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists"]
  }),
  defineStep({
    buttonLabel: "Run deep UI check",
    codex: DEEP_UI_CHECK_CODEX_HANDOFF,
    description: "JSKIT asks Codex for a focused UI quality pass when the issue affects UI, or records an explicit skip when it does not.",
    id: "deep_ui_check_run",
    kind: "codex_prompt",
    label: "Run deep UI check",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Run review/deslop",
    codex: REVIEW_EXECUTION_CODEX_HANDOFF,
    description: "JSKIT sends the current implementation to Codex for a review/deslop pass; the user decides whether to resolve findings, run deslop again, or continue.",
    id: "review_prompt_rendered",
    kind: "codex_prompt",
    label: "Run review/deslop",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Accept review/deslop",
    description: "User chooses whether to resolve the last deslop result, run deslop again, or continue.",
    id: "review_changes_accepted",
    kind: "user_check",
    label: "Accept review/deslop",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --review-findings-remaining false`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "deep_ui_check_satisfied"],
    submitOptions: Object.freeze({
      reviewFindingsRemaining: false
    })
  }),
  defineStep({
    buttonLabel: "Run automated checks",
    codex: AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
    description: "JSKIT asks Codex to run the official verification command in the worktree, fix failures, and report the final passing result.",
    id: "automated_checks_run",
    kind: "codex_prompt",
    label: "Run automated checks",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Complete user check",
    description: "User manually checks the result; if it fails, rewind to the step that should be redone.",
    id: "user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "Complete user check",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --user-check passed`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "automated_checks_passed", "deep_ui_check_satisfied"],
    utilityActions: Object.freeze([
      Object.freeze({
        id: "session_app_test",
        kind: "app_test",
        label: "Test app"
      })
    ])
  }),
  defineStep({
    buttonLabel: "Update blueprint",
    codex: BLUEPRINT_CODEX_HANDOFF,
    description: "JSKIT asks Codex to update durable app memory from the accepted work; Codex edits .jskit/APP_BLUEPRINT.md; JSKIT records the update for the accepted-work commit.",
    id: "blueprint_updated",
    kind: "codex_prompt",
    label: "Update blueprint",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "automated_checks_passed", "deep_ui_check_satisfied", "user_check_passed"]
  }),
  defineStep({
    buttonLabel: "Commit changes",
    description: "JSKIT commits the accepted session changes, including durable app memory updates, in the session worktree.",
    id: "changes_committed",
    label: "Commit changes",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_url_exists", "github_auth", "automated_checks_passed", "deep_ui_check_satisfied", "user_check_passed", "blueprint_update_satisfied"]
  }),
  defineStep({
    buttonLabel: "Create final report",
    description: "JSKIT creates the deterministic final session report and comments it on the GitHub issue.",
    id: "final_report_created",
    label: "Create final report",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "automated_checks_passed", "deep_ui_check_satisfied", "user_check_passed", "blueprint_update_satisfied", "accepted_changes_committed"]
  }),
  defineStep({
    buttonLabel: "Create PR",
    description: "JSKIT pushes the session branch to origin, creates or reuses the GitHub pull request, and records the PR URL.",
    id: "pr_created",
    label: "Create PR",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "automated_checks_passed", "deep_ui_check_satisfied", "user_check_passed", "accepted_changes_committed", "blueprint_update_satisfied", "final_report_exists"]
  }),
  defineStep({
    buttonLabel: "Open merge decision",
    codex: PR_MERGE_PREP_CODEX_HANDOFF,
    description: "User can ask Codex to prepare the pull request for merge, then explicitly continue to the merge decision.",
    id: "pr_merge_prepared",
    label: "Prepare PR merge",
    preconditions: ["session_exists", "pr_url_exists", "worktree_exists"],
    requiresExplicitRun: true,
    submitOptions: Object.freeze({
      continueToMerge: true
    }),
    utilityActions: Object.freeze([
      Object.freeze({
        id: "prepare_pr_merge",
        kind: "codex_prompt",
        label: "Prepare PR merge",
        submitOptions: Object.freeze({
          prepareMerge: true
        })
      })
    ])
  }),
  defineStep({
    buttonLabel: "Merge PR",
    description: "User chooses whether JSKIT merges the pull request or skips merge; JSKIT records the PR outcome.",
    id: "pr_finalized",
    label: "Finalize PR",
    preconditions: ["session_exists", "pr_url_exists", "worktree_exists"],
    requiresExplicitRun: true,
    submitOptions: Object.freeze({
      mergePr: true
    })
  }),
  defineStep({
    buttonLabel: "Sync main checkout",
    description: "JSKIT fast-forwards the main checkout after a merged PR, or records an explicit skip before cleanup.",
    id: "main_checkout_synced",
    label: "Sync main checkout",
    preconditions: ["session_exists", "worktree_exists"],
    requiresExplicitRun: true
  }),
  defineStep({
    buttonLabel: "Finish session",
    description: "JSKIT removes the session worktree and archives the completed session.",
    id: "session_finished",
    label: "Finish session",
    preconditions: ["session_exists", "main_checkout_sync_satisfied"]
  })
]);

const STEP_IDS = Object.freeze(STEP_DEFINITIONS.map((step) => step.id));
const STEP_LABEL_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step.label])));
const STEP_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step])));
const CYCLE_STEP_IDS = Object.freeze([]);
const STEP_PRECONDITION_NAMES = Object.freeze(Object.fromEntries(
  STEP_DEFINITIONS
    .filter((step) => step.id !== "session_created")
    .map((step) => [step.id, step.preconditions])
));

export {
  PROMPT_DIRECTORY,
  SESSION_ID_PATTERN,
  SESSION_STATUS,
  SESSION_WORKFLOW_VERSION,
  DEPENDENCIES_INSTALL_RESULT_FILE,
  REVIEW_PASS_LIMIT,
  CYCLE_STEP_IDS,
  STEP_DEFINITION_BY_ID,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_LABEL_BY_ID,
  STEP_PRECONDITION_NAMES,
  ISSUE_DEFINITION_CODEX_HANDOFF,
  ISSUE_FILE_CODEX_HANDOFF,
  PLAN_CODEX_HANDOFF,
  PLAN_EXECUTION_CODEX_HANDOFF,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  RESOLVE_DESLOP_CODEX_HANDOFF,
  DEEP_UI_CHECK_CODEX_HANDOFF,
  AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
  BLUEPRINT_CODEX_HANDOFF,
  PR_MERGE_PREP_CODEX_HANDOFF,
  JSKIT_CLI_SHELL_COMMAND,
  SESSION_STATE_RELATIVE_PATH
};
