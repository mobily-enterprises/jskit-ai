# JSKIT Session Revolution Plan

Current tracker: `FINAL_TODO.md` is the active implementation checklist for the post-Studio session workflow. This file records the original revolution milestone and remains useful background, but new work should be tracked in `FINAL_TODO.md`.

## Core Direction

- [x] Define the new source of truth: `jskit session` becomes the only supported issue workflow contract.
- [x] Keep Studio thin: `jskit-ai-studio` must call/session-drive this workflow, not own a parallel implementation.
- [x] Dismantle old AGENTS architecture: long AGENTS-driven workflow instructions are removed or relocated into prompt templates/session checks.
- [x] Leave only minimal `AGENTS.md`: it should say to use `jskit session`, inspect state, follow step output, and avoid manual workflow invention.
- [x] Keep no compatibility seam for the old long-agent-docs workflow architecture.
- [x] Make the workflow executable by `jskit session` alone. If an agent needs old `AGENTS.md` prose to know what to do, the port is incomplete.

## Phase 1: Session Model

- [x] Add a package-owned session runtime, probably under JSKIT CLI/server code first, with clean exports for Studio later.
- [x] Store active state in `<target-root>/.jskit/sessions/active/<session_id>/`.
- [x] Store worktrees in `<target-root>/.jskit/sessions/active/<session_id>/worktree`.
- [x] Use timestamp ids as primary ids, e.g. `2026-05-11_21-42-08`.
- [x] Store Codex thread ids only as optional metadata in `codex_thread_id`.
- [x] Add local exclude entry `.jskit/sessions/` to `<target-root>/.git/info/exclude`.
- [x] Do not write `.gitignore` unless explicitly requested.
- [x] Store session state as `current_step`, `status`, `issue_url`, `pr_url`, `prompt.md`, `issue.md`, and `terminal.log`.
- [x] Store receipts in `steps/<step_id>` with timestamp plus one readable sentence.
- [x] Derive branch as `jskit-studio/<session_id>`.
- [x] Derive worktree path from session id instead of storing it.
- [x] Keep active sessions in `active/`, finished sessions in `completed/`, and abandoned sessions in `abandoned/`.

## Phase 2: CLI Contract

- [x] Add `jskit session create`.
- [x] Add `jskit session <id>` to print minimal status.
- [x] Add `jskit session <id> step`.
- [x] Add `jskit session <id> step --prompt "..."`.
- [x] Add `jskit session <id> step --issue "..."`.
- [x] Add `jskit session <id> step --issue-file issue.md`.
- [x] Add `jskit session <id> step --issue -` for stdin.
- [x] Add `jskit session <id> abandon`.
- [x] Add app-level `jskit blueprint`, `jskit blueprint prompt`, and `jskit blueprint set`.
- [x] Make every command print deterministic plain text suitable for humans and Studio parsing.
- [x] Make every failed step print exact unmet preconditions and the command to retry.
- [x] Add `--json` to every session command from day one.
- [x] Keep default output minimal and human-readable.
- [x] Make `--json` output the stable machine-readable contract for Studio and other tools.
- [x] Never make Studio scrape human text output.
- [x] Ensure `--json` writes only JSON to stdout: no prose, colors, spinners, progress text, or logs.
- [x] Send any non-JSON diagnostic output to stderr when `--json` is used.
- [x] Contract-test JSON output for `create`, inspect, `step`, failed `step`, and `abandon`.
- [x] Include prompt text directly in JSON for V0 when a step renders a prompt.
- [x] Allow adding `promptPath` later for very large prompts without removing `prompt`.

## Phase 2A: JSON Output Contract

- [x] Successful commands should return a stable object shaped like:

```json
{
  "ok": true,
  "sessionId": "2026-05-11_21-42-08",
  "status": "waiting_for_user",
  "currentStep": "issue_prompt_rendered",
  "completedSteps": [
    "session_created",
    "worktree_created"
  ],
  "nextCommand": "jskit session 2026-05-11_21-42-08 step --prompt \"<what should change>\"",
  "prompt": "...",
  "issueUrl": "",
  "prUrl": "",
  "preconditions": [],
  "errors": []
}
```

- [x] Failed commands should return a stable object shaped like:

```json
{
  "ok": false,
  "sessionId": "2026-05-11_21-42-08",
  "status": "blocked",
  "currentStep": "issue_created",
  "completedSteps": [
    "session_created",
    "worktree_created",
    "issue_prompt_rendered",
    "issue_drafted"
  ],
  "nextCommand": "",
  "prompt": "",
  "issueUrl": "",
  "prUrl": "",
  "preconditions": [
    {
      "id": "github_auth",
      "ok": false,
      "message": "GitHub CLI is authenticated."
    }
  ],
  "errors": [
    {
      "code": "github_auth_missing",
      "message": "GitHub CLI is not authenticated.",
      "repairCommand": "gh auth login"
    }
  ]
}
```

- [x] Keep JSON field names stable and boring.
- [x] Prefer empty strings and empty arrays over missing fields for the top-level contract.
- [x] Use machine-readable `code` values for errors.
- [x] Use human-readable `message` values for direct UI display.
- [x] Include `nextCommand` whenever there is a clear next CLI action.
- [x] Include enough state for Studio to render tabs and selected-session panels without reading filesystem files directly.
- [x] Include JSKIT-owned `stepDefinitions`, `currentStepAction`, and Codex handoff metadata so Studio does not hard-code step ids or UI labels.
- [x] Keep step ids semantic and unique; use the ordered `stepDefinitions` array index for timeline order instead of numeric id prefixes.

## Phase 3: State Machine

- [x] Implement a boring explicit step list, not ad-hoc branching.
- [x] `session_created`: create state directory, add exclude rule, create receipt.
- [x] `worktree_created`: create branch and worktree.
- [x] `issue_prompt_rendered`: accept `--prompt`, render issue-writing prompt, store `prompt.md`.
- [x] `issue_drafted`: accept issue text, store `issue.md`.
- [x] `issue_created`: call `gh issue create`, store `issue_url`.
- [x] `implementation_prompt_rendered`: render implementation prompt with issue URL and issue text.
- [x] `implementation_changes_accepted`: verify and accept worktree changes.
- [x] `implementation_changes_committed`: commit current worktree changes.
- [x] `initial_review_prompt_rendered`: render review prompt.
- [x] `initial_review_changes_detected`: detect and commit review changes, or accept no changes.
- [x] `initial_user_check_completed`: run server/check prompt and wait for user confirmation.
- [x] `followup_review_prompt_rendered`: render second review prompt.
- [x] `followup_review_changes_detected`: detect and commit review changes, or accept no changes.
- [x] `followup_user_check_completed`: run server/check prompt and wait for user confirmation.
- [x] `final_review_prompt_rendered`: render final review prompt with explicit final-pass warning.
- [x] `final_review_changes_detected`: detect and commit final review changes, or accept no changes.
- [x] `final_user_check_completed`: final user confirmation.
- [x] `doctor_run`: run required verification/doctor command.
- [x] `branch_pushed`: push branch.
- [x] `pr_created`: create PR, store `pr_url`.
- [x] `pr_merged`: merge PR and close issue.
- [x] `worktree_removed`: remove worktree.
- [x] `session_finished`: write final receipt and mark `finished`.
- [x] Terminal states physically archive their session directories into `completed/` or `abandoned/`.

## Phase 4: Preconditions

- [x] Every step must have a named precondition function.
- [x] Session creation requires target root exists and is writable.
- [x] Worktree creation requires target is a git repo with a current branch.
- [x] GitHub issue creation requires `gh auth status` and an origin GitHub remote.
- [x] Implementation prompt requires `issue.md` and `issue_url`.
- [x] Review prompt requires committed implementation changes.
- [x] User-check steps require the previous review step receipt.
- [x] Doctor step requires no unresolved review/user-check phase.
- [x] PR creation requires pushed branch and passing doctor.
- [x] Merge requires PR URL and clean merge command result.
- [x] Abandon must close issue if created, remove worktree if present, and mark `abandoned`.

## Phase 5: Prompt Templates

- [x] Add package default prompt templates: `app_blueprint.md`, `new_issue.md`, `implement_issue.md`, `review_changes.md`, `user_check.md`, `doctor_failure.md`, `pr_failure.md`, and `final_comment.md`.
- [x] Support session prompt overrides in `<target-root>/.jskit/sessions/prompts/<name>.md`.
- [x] Support app blueprint prompt override in `<target-root>/.jskit/prompts/app_blueprint.md`.
- [x] Use simple placeholders only: `{{app_brief}}`, `{{user_input}}`, `{{issue_text}}`, `{{issue_url}}`, `{{changed_files}}`, `{{doctor_output}}`, and `{{session_id}}`.
- [x] Do not make AI calls inside JSKIT.
- [x] Do not add a complex template language.
- [x] Render prompts deterministically and save rendered prompt receipts where useful.
- [x] Make prompt output copy-pasteable for plain Codex CLI.
- [x] Make prompt output injectable by Studio without modification.

## Phase 6: AGENTS.md Removal

- [x] Audit all `AGENTS.md` files in JSKIT templates, docs, and generated app scaffolds.
- [x] Remove long workflow guidance from `AGENTS.md`.
- [x] Move reusable workflow instructions into prompt templates.
- [x] Move hard checks into session step preconditions.
- [x] Move recurring implementation rules into explicit session review prompts where applicable.
- [x] Ensure generated apps get only a tiny `AGENTS.md`.
- [x] Ensure `packages/agent-docs` no longer publishes the old long workflow as the active architecture.
- [x] Remove references telling agents to manually follow old distributed docs for issue workflow.
- [x] Keep only minimal bootstrap guidance: "Use `jskit session`; run `jskit session <id>`; run `jskit session <id> step`."
- [x] Add tests that generated `AGENTS.md` does not contain the old workflow bulk.
- [x] Make sure none of the old architecture is left as an active workflow path.

## Phase 7: Studio Integration

- [x] Studio lists sessions by calling JSKIT session runtime or CLI-backed API.
- [x] Studio does not create per-session JSKIT placements.
- [x] Studio shows tabs from filesystem session directories.
- [x] Studio selected tab shows current step, receipts, issue, PR, and transcript/log.
- [x] Studio exposes rendered prompts for copy/paste instead of owning Codex terminal injection.
- [x] Studio can still support manual copy/paste mode because the CLI remains authoritative.
- [x] Studio uses server-side state only; browser state may remember selected tab but not session truth.
- [x] Studio resumes sessions from filesystem after restart.
- [x] Studio does not own a second workflow state machine.

## Phase 8: Tests

- [x] Unit-test session id generation.
- [x] Unit-test state directory creation.
- [x] Unit-test exclude rule writing.
- [x] Unit-test each precondition failure message.
- [x] Unit-test each step transition.
- [x] Unit-test prompt override precedence.
- [x] Unit-test app blueprint command behavior and issue text extraction/acceptance.
- [x] Unit-test abandon cleanup behavior.
- [x] Unit-test completed/abandoned archive directory behavior.
- [x] Integration-test create -> issue prompt -> issue create with mocked `gh`.
- [x] Integration-test worktree branch creation with a temp git repo.
- [x] Integration-test review loop limit of three passes.
- [x] Contract-test generated `AGENTS.md` minimalism.
- [x] Contract-test that no old workflow docs remain as active instructions.

## Execution Order

- [x] First implement CLI-only session runtime.
- [x] Then convert prompts and `AGENTS.md`.
- [x] Then add tests and contracts.
- [x] Then wire Studio to the CLI/runtime.
- [x] Then remove obsolete Studio-local workflow code.
- [x] Finally run a full dogfood session against a tiny target app.

## Non-Negotiable Standard

- [x] The workflow must be executable by `jskit session` alone.
- [x] The code must be a simple state machine, not a clever orchestration framework.
- [x] Session truth must be file-backed and inspectable.
- [x] Prompt rendering must be deterministic and package-owned.
- [x] Studio must be a UI over the session system, not a second implementation.
- [x] Long `AGENTS.md` workflow architecture must be dismantled completely.
