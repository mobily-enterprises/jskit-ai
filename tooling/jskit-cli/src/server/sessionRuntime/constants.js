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
  promptActionLabel: "Execute plan"
});
const REVIEW_EXECUTION_CODEX_HANDOFF = codexHandoff([], {
  autoInject: true,
  promptActionLabel: "Start review"
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
  utilityActions = []
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
    preconditions: Object.freeze([...preconditions]),
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
    buttonLabel: "Submit prompt to Codex",
    description: "Capture the initial change request and send it to Codex to draft a GitHub issue.",
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
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Save issue draft",
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
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Create GitHub issue",
    description: "Create the GitHub issue from the approved draft.",
    id: "issue_created",
    label: "Issue created",
    preconditions: ["session_exists", "issue_text_exists", "github_auth", "github_origin"]
  }),
  defineStep({
    buttonLabel: "Execute plan",
    codex: codexHandoff(PLAN_OUTPUT),
    description: "Save the approved implementation plan, comment it on the GitHub issue, and submit it to Codex.",
    id: "plan_made",
    input: PLAN_INPUT,
    kind: "codex_output",
    label: "Plan execution",
    nextCommandTemplate: "jskit session {{session_id}} step --plan -",
    preconditions: ["session_exists", "issue_text_exists", "issue_url_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Accept changes",
    description: "Review the worktree diff and accept the changes as ready to commit.",
    id: "implementation_changes_accepted",
    kind: "user_check",
    label: "Changes accepted",
    preconditions: ["session_exists", "worktree_exists"],
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
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Start review",
    description: "Submit the code review prompt to Codex for the committed changes.",
    id: "review_prompt_rendered",
    kind: "codex_prompt",
    label: "Review execution",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Accept review changes",
    description: "Review the post-review worktree diff and accept it as ready to commit.",
    id: "review_changes_accepted",
    kind: "user_check",
    label: "Review changes accepted",
    preconditions: ["session_exists", "worktree_exists"],
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
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Save user check",
    description: "Record whether the user’s manual check passed.",
    id: "user_check_completed",
    input: USER_CHECK_INPUT,
    kind: "user_check",
    label: "User check",
    nextCommandTemplate: "jskit session {{session_id}} step --user-check passed",
    preconditions: ["session_exists"]
  }),
  defineStep({
    buttonLabel: "Run verification",
    description: "Run the project verification command in the session worktree.",
    id: "doctor_run",
    label: "Verification run",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Push branch and create PR",
    description: "Push the session branch to origin and create a GitHub pull request.",
    id: "pr_created",
    label: "Branch pushed, PR created",
    preconditions: ["session_exists", "worktree_exists"]
  }),
  defineStep({
    buttonLabel: "Merge PR and remove worktree",
    description: "Merge the pull request, close the GitHub issue, and remove the session worktree.",
    id: "pr_merged",
    label: "PR merged, worktree removed",
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
  PLAN_EXECUTION_CODEX_HANDOFF,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  SESSION_STATE_RELATIVE_PATH
};
