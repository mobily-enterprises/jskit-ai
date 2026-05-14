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
const SESSION_WORKFLOW_VERSION = "6";
const REVIEW_PASS_LIMIT = 0;
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const JSKIT_CLI_SHELL_COMMAND = "npx --no-install jskit";
const JSKIT_CLI_SHELL_RULE = [
  "Shell command rule:",
  "",
  `- When running JSKIT CLI commands from the shell, use \`${JSKIT_CLI_SHELL_COMMAND} ...\`.`,
  "- Do not run bare `jskit ...` unless you are inside an npm script where `node_modules/.bin` is on PATH.",
  "- Do not run `npx jskit ...` without `--no-install`; it may fetch packages instead of using this app's installed CLI.",
  "- If `npx --no-install jskit ...` is unavailable, continue with filesystem inspection when possible and report that the local JSKIT CLI is missing."
].join("\n");
const DEFAULT_NEXT_COMMAND_TEMPLATE = `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step`;

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
const ISSUE_DETAILS_INPUT = Object.freeze({
  extract: "issue_details",
  formatHint: "markdown",
  label: "Confirmed issue details",
  multiline: true,
  name: "issueDetails",
  required: true,
  type: "text"
});
const ISSUE_DETAILS_OUTPUT = Object.freeze({
  extract: "issue_details",
  field: "issueDetails",
  formatHint: "markdown",
  label: "Issue details",
  multiline: true,
  required: true
});
const ISSUE_CATEGORY_OUTPUT = Object.freeze({
  extract: "issue_category",
  field: "issueCategory",
  formatHint: "text",
  label: "Issue category",
  options: Object.freeze([
    Object.freeze({ label: "Client", value: "client" }),
    Object.freeze({ label: "Server", value: "server" }),
    Object.freeze({ label: "Client and server", value: "client_server" }),
    Object.freeze({ label: "Tooling", value: "tooling" }),
    Object.freeze({ label: "Unknown", value: "unknown" })
  ]),
  required: true
});
const UI_IMPACT_OUTPUT = Object.freeze({
  extract: "ui_impact",
  field: "uiImpact",
  formatHint: "text",
  label: "UI impact",
  options: Object.freeze([
    Object.freeze({ label: "No UI impact", value: "none" }),
    Object.freeze({ label: "Possible UI impact", value: "possible" }),
    Object.freeze({ label: "Definite UI impact", value: "definite" }),
    Object.freeze({ label: "Unknown", value: "unknown" })
  ]),
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
const ISSUE_DETAILS_CODEX_HANDOFF = codexHandoff([
  ISSUE_CATEGORY_OUTPUT,
  UI_IMPACT_OUTPUT,
  ISSUE_DETAILS_OUTPUT
], {
  autoInject: true,
  promptActionLabel: "Start details conversation"
});
const REVIEW_EXECUTION_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Run deslop"
});
const DEEP_UI_CHECK_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Run Deep UI check"
});
const AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Run automated checks"
});
const BLUEPRINT_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
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
  nextCommandTemplate = DEFAULT_NEXT_COMMAND_TEMPLATE,
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
    description: "JSKIT creates the filesystem-backed session record and initial receipt.",
    id: "session_created",
    label: "Session created"
  }),
  defineStep({
    buttonLabel: "Create worktree",
    description: "JSKIT creates the isolated Git branch and session worktree where Codex will work.",
    id: "worktree_created",
    label: "Worktree created",
    preconditions: ["session_exists", "git_repository", "git_current_branch"]
  }),
  defineStep({
    buttonLabel: "Install dependencies",
    description: "JSKIT installs Node dependencies inside the session worktree before Codex starts.",
    id: "dependencies_installed",
    label: "Dependencies installed",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Set initial prompt",
    description: "User describes the requested change; JSKIT records it and prepares the Codex issue-drafting prompt.",
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
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --prompt "<what should change>"`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Finalise issue",
    codex: codexHandoff([
      ISSUE_TITLE_OUTPUT,
      ISSUE_TEXT_OUTPUT
    ], {
      autoInject: true,
      promptActionLabel: "Get Codex to create issue text"
    }),
    description: "Codex drafts the issue title and body; user reviews or edits them; JSKIT saves the approved draft.",
    id: "issue_drafted",
    input: ISSUE_DRAFT_INPUT,
    kind: "codex_output",
    label: "Issue drafted",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --issue -`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app"]
  }),
  defineStep({
    buttonLabel: "Create issue",
    description: "JSKIT creates the GitHub issue from the approved draft and records the issue URL.",
    id: "issue_created",
    label: "Issue created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "github_auth", "github_origin"],
    requiresExplicitRun: false
  }),
  defineStep({
    buttonLabel: "Save issue details",
    codex: ISSUE_DETAILS_CODEX_HANDOFF,
    description: "Codex finalises with user issue details and classification; user reviews or edits final outcome; JSKIT saves the confirmed details.",
    displayGroupId: "issue_details",
    displayGroupLabel: "Get issue details",
    id: "issue_details_gathered",
    input: ISSUE_DETAILS_INPUT,
    kind: "codex_output",
    label: "Issue details gathered",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --issue-details -`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists"]
  }),
  defineStep({
    buttonLabel: "Save plan",
    codex: codexHandoff(PLAN_OUTPUT, {
      autoInject: true,
      promptActionLabel: "Get Codex to create plan"
    }),
    description: "Codex writes an implementation plan for the active cycle; cycle 001 plans from the issue, later cycles plan from user rework notes.",
    id: "plan_made",
    input: PLAN_INPUT,
    kind: "codex_output",
    label: "Plan made",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --plan -`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists", "issue_details_exists", "issue_metadata_exists", "active_cycle_exists"]
  }),
  defineStep({
    buttonLabel: "Get Codex to execute plan",
    codex: PLAN_EXECUTION_CODEX_HANDOFF,
    description: "JSKIT sends the active cycle plan to Codex; Codex implements it; Studio advances when Codex finishes.",
    id: "plan_executed",
    kind: "codex_prompt",
    label: "Plan executed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_text_exists", "issue_url_exists", "issue_details_exists", "issue_metadata_exists", "active_cycle_exists", "plan_text_exists"]
  }),
  defineStep({
    buttonLabel: "Run Deep UI check",
    codex: DEEP_UI_CHECK_CODEX_HANDOFF,
    description: "JSKIT asks Codex for a focused UI quality pass when the issue affects UI, or records a skip receipt when it does not.",
    id: "deep_ui_check_run",
    kind: "codex_prompt",
    label: "Deep UI check run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists"]
  }),
  defineStep({
    buttonLabel: "Run deslop",
    codex: REVIEW_EXECUTION_CODEX_HANDOFF,
    description: "JSKIT sends the current implementation to Codex for a review/deslop pass; Codex reports findings and applies the selected cleanup.",
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    id: "review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review/deslop",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "I am done",
    description: "User confirms the review/deslop loop is done; JSKIT records the loop result without committing yet.",
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    id: "review_changes_accepted",
    kind: "user_check",
    label: "Review/deslop",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --review-findings-remaining false`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Run automated checks",
    codex: AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
    description: "JSKIT asks Codex to run automated checks in the worktree, fix failures, and report the final result.",
    id: "automated_checks_run",
    kind: "codex_prompt",
    label: "Automated checks",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Save user check",
    description: "User manually checks the result; JSKIT records pass or collects rework notes for another plan cycle.",
    id: "user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check",
    nextCommandTemplate: `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step --user-check passed`,
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied"]
  }),
  defineStep({
    buttonLabel: "Commit accepted changes",
    description: "JSKIT commits the user-accepted session changes in the session worktree.",
    id: "changes_committed",
    label: "Changes committed",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "issue_url_exists", "github_auth", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied", "active_cycle_user_check_passed"]
  }),
  defineStep({
    buttonLabel: "Update blueprint",
    codex: BLUEPRINT_CODEX_HANDOFF,
    description: "JSKIT asks Codex to update durable app memory from the accepted work; Codex edits .jskit/APP_BLUEPRINT.md; JSKIT records and commits the update.",
    id: "blueprint_updated",
    kind: "codex_prompt",
    label: "Blueprint updated",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied", "active_cycle_user_check_passed", "accepted_changes_committed"]
  }),
  defineStep({
    buttonLabel: "Run verification",
    description: "JSKIT runs the final project verification command in the session worktree and records the result.",
    id: "doctor_run",
    label: "Verification run",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied", "active_cycle_user_check_passed", "accepted_changes_committed", "blueprint_update_satisfied"]
  }),
  defineStep({
    buttonLabel: "Create final report",
    description: "JSKIT creates the deterministic final session report and comments it on the GitHub issue.",
    id: "final_report_created",
    label: "Final report created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied", "active_cycle_user_check_passed", "accepted_changes_committed", "blueprint_update_satisfied"]
  }),
  defineStep({
    buttonLabel: "Push branch and create PR",
    description: "JSKIT pushes the session branch to origin, creates or reuses the GitHub pull request, and records the PR URL.",
    id: "pr_created",
    label: "Branch pushed, PR created",
    preconditions: ["session_exists", "worktree_exists", "dependencies_installed", "ready_jskit_app", "issue_metadata_exists", "active_cycle_exists", "automated_checks_passed", "deep_ui_check_satisfied", "active_cycle_user_check_passed", "accepted_changes_committed", "blueprint_update_satisfied", "final_report_exists"]
  }),
  defineStep({
    buttonLabel: "Merge PR",
    description: "User chooses whether JSKIT merges the pull request or finishes without merge; JSKIT then removes the session worktree.",
    id: "pr_finalized",
    label: "PR finalized, worktree removed",
    preconditions: ["session_exists", "pr_url_exists", "worktree_exists"],
    requiresExplicitRun: true
  }),
  defineStep({
    buttonLabel: "Finish session",
    description: "JSKIT writes the final receipt and archives the completed session.",
    id: "session_finished",
    label: "Session finished",
    preconditions: ["session_exists"]
  })
]);

const STEP_IDS = Object.freeze(STEP_DEFINITIONS.map((step) => step.id));
const STEP_LABEL_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step.label])));
const STEP_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(STEP_DEFINITIONS.map((step) => [step.id, step])));
const CYCLE_STEP_IDS = Object.freeze([
  "plan_made",
  "plan_executed",
  "deep_ui_check_run",
  "review_prompt_rendered",
  "review_changes_accepted",
  "automated_checks_run",
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
  ISSUE_DETAILS_CODEX_HANDOFF,
  PLAN_EXECUTION_CODEX_HANDOFF,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  DEEP_UI_CHECK_CODEX_HANDOFF,
  AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
  BLUEPRINT_CODEX_HANDOFF,
  JSKIT_CLI_SHELL_COMMAND,
  JSKIT_CLI_SHELL_RULE,
  SESSION_STATE_RELATIVE_PATH
};
