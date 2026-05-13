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
const SESSION_WORKFLOW_VERSION = "2";
const REVIEW_PASS_LIMIT = 3;
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");

const INPUT_NONE = Object.freeze({ type: "none" });
const ISSUE_TITLE_INPUT = Object.freeze({
  extract: "issue_title",
  formatHint: "text",
  label: "Approved issue title",
  name: "issueTitle",
  required: true,
  type: "text"
});
const ISSUE_TEXT_INPUT = Object.freeze({
  extract: "issue_text",
  formatHint: "markdown",
  label: "Approved issue body",
  multiline: true,
  name: "issue",
  required: true,
  type: "text"
});
const ISSUE_DRAFT_INPUT = Object.freeze({
  fields: Object.freeze([
    ISSUE_TITLE_INPUT,
    ISSUE_TEXT_INPUT
  ]),
  type: "object"
});
const ISSUE_TITLE_OUTPUT = Object.freeze({
  extract: "issue_title",
  field: "issueTitle",
  formatHint: "text",
  label: "Issue title",
  required: true
});
const ISSUE_TEXT_OUTPUT = Object.freeze({
  extract: "issue_text",
  field: "issue",
  formatHint: "markdown",
  label: "Issue body",
  multiline: true,
  required: true
});
const PLAN_INPUT = Object.freeze({
  extract: "plan",
  formatHint: "markdown",
  label: "Approved plan",
  multiline: true,
  name: "plan",
  required: true,
  type: "text"
});
const PLAN_OUTPUT = Object.freeze({
  extract: "plan",
  field: "plan",
  formatHint: "markdown",
  label: "Plan",
  multiline: true,
  required: true
});
const BLUEPRINT_INPUT = Object.freeze({
  extract: "app_blueprint",
  formatHint: "markdown",
  label: "Updated app blueprint",
  multiline: true,
  name: "blueprint",
  required: true,
  type: "text"
});
const BLUEPRINT_OUTPUT = Object.freeze({
  extract: "app_blueprint",
  field: "blueprint",
  formatHint: "markdown",
  label: "Updated app blueprint",
  multiline: true,
  required: true
});
const PLAN_DETAILS_INPUT = Object.freeze({
  extract: "plan_details",
  formatHint: "markdown",
  label: "Confirmed implementation details",
  multiline: true,
  name: "planDetails",
  required: true,
  type: "text"
});
const PLAN_DETAILS_OUTPUT = Object.freeze({
  extract: "plan_details",
  field: "planDetails",
  formatHint: "markdown",
  label: "Plan details",
  multiline: true,
  required: true
});
const ISSUE_CATEGORY_OUTPUT = Object.freeze({
  extract: "issue_category",
  field: "issueCategory",
  formatHint: "text",
  label: "Issue category",
  required: true
});
const UI_IMPACT_OUTPUT = Object.freeze({
  extract: "ui_impact",
  field: "uiImpact",
  formatHint: "text",
  label: "UI impact",
  required: true
});
const USER_CHECK_INPUT = Object.freeze({
  label: "User check result",
  name: "userCheck",
  options: Object.freeze([
    Object.freeze({ label: "Passed", value: "passed" }),
    Object.freeze({ label: "Failed", value: "failed" })
  ]),
  required: true,
  type: "choice"
});
function codexHandoff(expectedOutput, {
  autoInject = false,
  promptActionLabel = ""
} = {}) {
  const expectedOutputs = Object.freeze(Array.isArray(expectedOutput) ? [...expectedOutput] : [expectedOutput]);
  return Object.freeze({
    ...(autoInject ? { autoInject: true } : {}),
    expectedOutput: expectedOutputs[expectedOutputs.length - 1] || null,
    expectedOutputs,
    mode: "inject_prompt",
    promptField: "prompt",
    ...(promptActionLabel ? { promptActionLabel } : {})
  });
}

const PLAN_EXECUTION_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Get Codex to execute plan"
});
const PLAN_FINE_TUNING_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Get Codex to fine tune plan"
});
const REVIEW_EXECUTION_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Start review"
});
const DEEP_UI_CHECK_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Run Deep UI check"
});
const BLUEPRINT_CODEX_HANDOFF = codexHandoff(BLUEPRINT_OUTPUT, {
  promptActionLabel: "Update blueprint"
});

function defineStep({
  buttonLabel,
  codex = undefined,
  description,
  id,
  input = INPUT_NONE,
  kind = "automatic",
  label,
  nextCommandTemplate = "jskit session {{session_id}} step",
  preconditions = [],
  requiresExplicitRun = false,
  utilityActions = [],
  displayGroupId = "",
  displayGroupLabel = ""
}) {
  return Object.freeze({
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
    utilityActions: Object.freeze([...utilityActions])
  });
}

const STEP_DEFINITIONS = Object.freeze([
  defineStep({
    buttonLabel: "Create session",
    description: "Create the filesystem-backed session record.",
    id: "session_created",
    label: "Session created"
  }),
  defineStep({
    buttonLabel: "Create worktree",
    description: "Create the isolated branch and worktree for this session.",
    id: "worktree_created",
    label: "Worktree created",
    preconditions: ["session_exists", "git_repository", "git_current_branch"]
  }),
  defineStep({
    buttonLabel: "Install dependencies",
    description: "Install Node dependencies inside the session worktree before Codex starts.",
    id: "dependencies_installed",
    label: "Dependencies installed",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Set initial prompt",
    description: "Capture the initial change request and prepare the Codex issue-drafting prompt.",
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
    label: "Initial issue prompt",
    nextCommandTemplate: "jskit session {{session_id}} step --prompt \"<what should change>\"",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Finalise issue",
    codex: codexHandoff([
      ISSUE_TITLE_OUTPUT,
      ISSUE_TEXT_OUTPUT
    ]),
    description: "Save the approved issue title and body drafted by Codex.",
    id: "issue_drafted",
    input: ISSUE_DRAFT_INPUT,
    kind: "codex_output",
    label: "Issue drafted",
    nextCommandTemplate: "jskit session {{session_id}} step --issue -",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Create issue",
    description: "Create the GitHub issue from the approved draft.",
    id: "issue_created",
    label: "Issue created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "github_auth", "github_origin"],
    requiresExplicitRun: true
  }),
  defineStep({
    buttonLabel: "Start details conversation",
    codex: codexHandoff([
      ISSUE_CATEGORY_OUTPUT,
      UI_IMPACT_OUTPUT,
      PLAN_DETAILS_OUTPUT
    ], {
      autoInject: true,
      promptActionLabel: "Start details conversation"
    }),
    description: "Ask Codex to gather the missing implementation details before planning.",
    displayGroupId: "plan_details",
    displayGroupLabel: "Get issue details",
    id: "plan_details_prompt_rendered",
    kind: "codex_prompt",
    label: "Get issue details",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists"]
  }),
  defineStep({
    buttonLabel: "Save plan details",
    codex: codexHandoff([
      ISSUE_CATEGORY_OUTPUT,
      UI_IMPACT_OUTPUT,
      PLAN_DETAILS_OUTPUT
    ]),
    description: "Save the confirmed implementation details and classification from Codex.",
    displayGroupId: "plan_details",
    displayGroupLabel: "Get issue details",
    id: "plan_details_gathered",
    input: PLAN_DETAILS_INPUT,
    kind: "codex_output",
    label: "Plan details gathered",
    nextCommandTemplate: "jskit session {{session_id}} step --plan-details -",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists"]
  }),
  defineStep({
    buttonLabel: "Save plan",
    codex: codexHandoff(PLAN_OUTPUT),
    description: "Save the approved implementation plan and comment it on the GitHub issue.",
    id: "plan_made",
    input: PLAN_INPUT,
    kind: "codex_output",
    label: "Plan made",
    nextCommandTemplate: "jskit session {{session_id}} step --plan -",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists", "plan_details_exists", "issue_metadata_exists"]
  }),
  defineStep({
    buttonLabel: "Get Codex to execute plan",
    description: "Submit the approved implementation plan to Codex for the first implementation pass.",
    id: "plan_executed",
    kind: "codex_prompt",
    label: "Plan executed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists", "plan_details_exists", "issue_metadata_exists", "plan_text_exists"]
  }),
  defineStep({
    buttonLabel: "Get Codex to fine tune plan",
    description: "Submit the current implementation to Codex for refinement after the first implementation pass.",
    id: "plan_fine_tuning",
    kind: "codex_prompt",
    label: "Plan fine tuning",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists", "plan_details_exists", "issue_metadata_exists", "plan_text_exists", "active_cycle_exists"]
  }),
  defineStep({
    buttonLabel: "Accept changes",
    description: "Review the worktree diff and accept the changes as ready to commit.",
    id: "implementation_changes_accepted",
    kind: "user_check",
    label: "Changes accepted",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists"],
    utilityActions: Object.freeze([
      Object.freeze({
        id: "session_diff",
        kind: "diff",
        label: "Review changes",
        nextCommandTemplate: "jskit session {{session_id}} diff"
      })
    ])
  }),
  defineStep({
    buttonLabel: "Commit implementation",
    description: "Commit the accepted implementation changes in the session worktree.",
    id: "implementation_changes_committed",
    label: "Changes committed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists"]
  }),
  defineStep({
    buttonLabel: "Run checks",
    description: "Run automated checks before the deslop/JSKIT review pass.",
    id: "pre_review_checks_run",
    label: "Pre-review checks run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists"]
  }),
  defineStep({
    buttonLabel: "Run Deep UI check",
    description: "Run or skip the focused UI quality pass before deslop/JSKIT review.",
    id: "deep_ui_check_run",
    label: "Deep UI check run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed"]
  }),
  defineStep({
    buttonLabel: "Accept Deep UI changes",
    description: "Review the Deep UI Check diff and accept it as ready to commit, or record that no changes were needed.",
    displayGroupId: "deep_ui_check",
    displayGroupLabel: "Deep UI check",
    id: "deep_ui_check_changes_accepted",
    kind: "user_check",
    label: "Deep UI changes accepted",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed"],
    utilityActions: Object.freeze([
      Object.freeze({
        id: "session_diff",
        kind: "diff",
        label: "Review changes",
        nextCommandTemplate: "jskit session {{session_id}} diff"
      })
    ])
  }),
  defineStep({
    buttonLabel: "Commit Deep UI changes",
    description: "Commit accepted Deep UI Check changes, or record that no changes were needed.",
    displayGroupId: "deep_ui_check",
    displayGroupLabel: "Deep UI check",
    id: "deep_ui_check_changes_committed",
    label: "Deep UI changes committed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed"]
  }),
  defineStep({
    buttonLabel: "Start review",
    description: "Submit the code review prompt to Codex for the committed changes.",
    id: "review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review execution",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Accept review changes",
    description: "Review the post-review worktree diff and accept it as ready to commit.",
    id: "review_changes_accepted",
    kind: "user_check",
    label: "Review changes accepted",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied"],
    utilityActions: Object.freeze([
      Object.freeze({
        id: "session_diff",
        kind: "diff",
        label: "Review changes",
        nextCommandTemplate: "jskit session {{session_id}} diff"
      })
    ])
  }),
  defineStep({
    buttonLabel: "Commit review changes",
    description: "Commit accepted review changes, or record that no review changes were needed.",
    id: "review_changes_committed",
    label: "Review changes committed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Run checks again",
    description: "Run automated checks after the deslop/JSKIT review pass.",
    id: "post_review_checks_run",
    label: "Post-review checks run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Run Deep UI re-check",
    description: "Run or skip the focused UI quality pass after deslop/JSKIT review.",
    id: "deep_ui_recheck_run",
    label: "Deep UI re-check run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed"]
  }),
  defineStep({
    buttonLabel: "Accept Deep UI re-check changes",
    description: "Review the Deep UI Re-check diff and accept it as ready to commit, or record that no changes were needed.",
    displayGroupId: "deep_ui_recheck",
    displayGroupLabel: "Deep UI re-check",
    id: "deep_ui_recheck_changes_accepted",
    kind: "user_check",
    label: "Deep UI re-check changes accepted",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed"],
    utilityActions: Object.freeze([
      Object.freeze({
        id: "session_diff",
        kind: "diff",
        label: "Review changes",
        nextCommandTemplate: "jskit session {{session_id}} diff"
      })
    ])
  }),
  defineStep({
    buttonLabel: "Commit Deep UI re-check changes",
    description: "Commit accepted Deep UI Re-check changes, or record that no changes were needed.",
    displayGroupId: "deep_ui_recheck",
    displayGroupLabel: "Deep UI re-check",
    id: "deep_ui_recheck_changes_committed",
    label: "Deep UI re-check changes committed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed"]
  }),
  defineStep({
    buttonLabel: "Save user check",
    description: "Record whether the user’s manual check passed.",
    id: "user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check",
    nextCommandTemplate: "jskit session {{session_id}} step --user-check passed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed", "deep_ui_recheck_satisfied"]
  }),
  defineStep({
    buttonLabel: "Update blueprint",
    codex: BLUEPRINT_CODEX_HANDOFF,
    description: "Update durable app memory from the accepted issue work.",
    id: "blueprint_updated",
    input: BLUEPRINT_INPUT,
    kind: "codex_output",
    label: "Blueprint updated",
    nextCommandTemplate: "jskit session {{session_id}} step --blueprint -",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed", "deep_ui_recheck_satisfied", "active_cycle_user_check_passed"]
  }),
  defineStep({
    buttonLabel: "Run verification",
    description: "Run the project verification command in the session worktree.",
    id: "doctor_run",
    label: "Verification run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed", "deep_ui_recheck_satisfied", "active_cycle_user_check_passed", "blueprint_update_satisfied"]
  }),
  defineStep({
    buttonLabel: "Create final report",
    description: "Create and comment the deterministic final session report.",
    id: "final_report_created",
    label: "Final report created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed", "deep_ui_recheck_satisfied", "active_cycle_user_check_passed", "blueprint_update_satisfied"]
  }),
  defineStep({
    buttonLabel: "Push branch and create PR",
    description: "Push the session branch to origin and create a GitHub pull request.",
    id: "pr_created",
    label: "Branch pushed, PR created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "pre_review_checks_passed", "deep_ui_check_satisfied", "post_review_checks_passed", "deep_ui_recheck_satisfied", "active_cycle_user_check_passed", "blueprint_update_satisfied", "final_report_exists"]
  }),
  defineStep({
    buttonLabel: "Finalize PR",
    description: "Merge the pull request or finish without merging, record the outcome, and remove the session worktree.",
    id: "pr_finalized",
    label: "PR finalized, worktree removed",
    preconditions: ["session_exists", "pr_url_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Finish session",
    description: "Write the final receipt and archive the completed session.",
    id: "session_finished",
    label: "Session finished",
    preconditions: ["session_exists"]
  })
]);

const STEP_IDS = Object.freeze(STEP_DEFINITIONS.map((step) => step.id));
const STEP_LABEL_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step.label])));
const STEP_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step])));
const CYCLE_STEP_IDS = Object.freeze([
  "plan_fine_tuning",
  "implementation_changes_accepted",
  "implementation_changes_committed",
  "pre_review_checks_run",
  "deep_ui_check_run",
  "deep_ui_check_changes_accepted",
  "deep_ui_check_changes_committed",
  "review_prompt_rendered",
  "review_changes_accepted",
  "review_changes_committed",
  "post_review_checks_run",
  "deep_ui_recheck_run",
  "deep_ui_recheck_changes_accepted",
  "deep_ui_recheck_changes_committed",
  "user_check_completed"
]);
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
  REVIEW_PASS_LIMIT,
  CYCLE_STEP_IDS,
  STEP_DEFINITION_BY_ID,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_LABEL_BY_ID,
  STEP_PRECONDITION_NAMES,
  PLAN_EXECUTION_CODEX_HANDOFF,
  PLAN_FINE_TUNING_CODEX_HANDOFF,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  DEEP_UI_CHECK_CODEX_HANDOFF,
  BLUEPRINT_CODEX_HANDOFF,
  SESSION_STATE_RELATIVE_PATH
};
