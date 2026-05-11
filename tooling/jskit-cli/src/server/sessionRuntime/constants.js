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
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");

const INPUT_NONE = Object.freeze({ type: "none" });
const ISSUE_TEXT_INPUT = Object.freeze({
  extract: "issue_text",
  formatHint: "markdown",
  label: "Approved issue text",
  multiline: true,
  name: "issue",
  required: true,
  type: "text"
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
const CODEX_WORKTREE_OUTPUT = Object.freeze({
  field: "worktree",
  formatHint: "git_changes"
});

function codexHandoff(expectedOutput) {
  return Object.freeze({
    expectedOutput,
    mode: "inject_prompt",
    promptField: "prompt"
  });
}

function defineStep({
  buttonLabel,
  codex = undefined,
  description,
  id,
  input = INPUT_NONE,
  kind = "automatic",
  label,
  nextCommandTemplate = "jskit session {{session_id}} step",
  preconditions = []
}) {
  return Object.freeze({
    buttonLabel,
    codex,
    description,
    id,
    input,
    kind,
    label,
    nextCommandTemplate,
    preconditions: Object.freeze([...preconditions])
  });
}

const STEP_DEFINITIONS = Object.freeze([
  defineStep({
    buttonLabel: "Create session",
    description: "Create the filesystem-backed session state.",
    id: "session_created",
    label: "Session created"
  }),
  defineStep({
    buttonLabel: "Create worktree",
    description: "Create the isolated session worktree and branch.",
    id: "worktree_created",
    label: "Worktree created",
    preconditions: ["session_exists", "git_repository", "git_current_branch"]
  }),
  defineStep({
    buttonLabel: "Render issue prompt",
    description: "Render the prompt Codex should use to draft the GitHub issue.",
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
    label: "Issue prompt rendered",
    nextCommandTemplate: "jskit session {{session_id}} step --prompt \"<what should change>\"",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Save issue text",
    codex: codexHandoff(Object.freeze({
      extract: "issue_text",
      field: "issue",
      formatHint: "markdown"
    })),
    description: "Save the approved issue text produced by Codex.",
    id: "issue_drafted",
    input: ISSUE_TEXT_INPUT,
    kind: "codex_output",
    label: "Issue drafted",
    nextCommandTemplate: "jskit session {{session_id}} step --issue -",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Create GitHub issue",
    description: "Create the GitHub issue with gh.",
    id: "issue_created",
    label: "Issue created",
    preconditions: ["session_exists", "issue_text_exists", "github_auth", "github_origin"]
  }),
  defineStep({
    buttonLabel: "Render implementation prompt",
    description: "Render the prompt Codex should use to implement the approved issue.",
    id: "implementation_prompt_rendered",
    kind: "codex_prompt",
    label: "Implementation prompt rendered",
    preconditions: ["session_exists", "issue_artifacts"]
  }),
  defineStep({
    buttonLabel: "Detect implementation changes",
    codex: codexHandoff(CODEX_WORKTREE_OUTPUT),
    description: "Confirm that Codex changed files in the session worktree.",
    id: "implementation_changes_detected",
    kind: "codex_output",
    label: "Changes detected",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Commit implementation",
    description: "Commit the implementation changes in the session worktree.",
    id: "implementation_changes_committed",
    label: "Changes committed",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Render review prompt 1",
    description: "Render the first Codex review prompt for the committed changes.",
    id: "initial_review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review prompt rendered 1",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Detect review changes 1",
    codex: codexHandoff(CODEX_WORKTREE_OUTPUT),
    description: "Commit any changes Codex made after the first review pass.",
    id: "initial_review_changes_detected",
    kind: "codex_output",
    label: "Review changes detected 1",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Save user check 1",
    description: "Record whether the first user check passed.",
    id: "initial_user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check 1",
    nextCommandTemplate: "jskit session {{session_id}} step --user-check passed",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Render review prompt 2",
    description: "Render the second Codex review prompt for the committed changes.",
    id: "followup_review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review prompt rendered 2",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Detect review changes 2",
    codex: codexHandoff(CODEX_WORKTREE_OUTPUT),
    description: "Commit any changes Codex made after the second review pass.",
    id: "followup_review_changes_detected",
    kind: "codex_output",
    label: "Review changes detected 2",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Save user check 2",
    description: "Record whether the second user check passed.",
    id: "followup_user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check 2",
    nextCommandTemplate: "jskit session {{session_id}} step --user-check passed",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Render final review prompt",
    description: "Render the final Codex review prompt before verification and PR.",
    id: "final_review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review prompt rendered 3",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Detect final review changes",
    codex: codexHandoff(CODEX_WORKTREE_OUTPUT),
    description: "Commit any changes Codex made after the final review pass.",
    id: "final_review_changes_detected",
    kind: "codex_output",
    label: "Review changes detected 3",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Save final user check",
    description: "Record whether the final user check passed.",
    id: "final_user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check 3",
    nextCommandTemplate: "jskit session {{session_id}} step --user-check passed",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Run verification",
    description: "Run the project verification command in the session worktree.",
    id: "doctor_run",
    label: "Doctor run",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Push branch",
    description: "Push the session branch to origin.",
    id: "branch_pushed",
    label: "Branch pushed",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Create PR",
    description: "Create a GitHub pull request for the session branch.",
    id: "pr_created",
    label: "PR created",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Merge PR",
    description: "Merge the pull request and close the GitHub issue.",
    id: "pr_merged",
    label: "PR merged",
    preconditions: ["session_exists", "pr_url_exists"]
  }),
  defineStep({
    buttonLabel: "Remove worktree",
    description: "Remove the session worktree after the PR has merged.",
    id: "worktree_removed",
    label: "Worktree removed",
    preconditions: ["session_exists"]
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
const STEP_PRECONDITION_NAMES = Object.freeze(Object.fromEntries(
  STEP_DEFINITIONS
    .filter((step) => step.id !== "session_created")
    .map((step) => [step.id, step.preconditions])
));

export {
  PROMPT_DIRECTORY,
  SESSION_ID_PATTERN,
  SESSION_STATUS,
  STEP_DEFINITION_BY_ID,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_LABEL_BY_ID,
  STEP_PRECONDITION_NAMES,
  SESSION_STATE_RELATIVE_PATH
};
