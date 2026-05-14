# FINAL TODO: JSKIT Session Workflow Hardening

This file is the implementation checklist for the next major JSKIT session workflow revision. Tick items as they are completed. Do not treat this as a loose workboard for an app session; this is the product-level implementation plan for JSKIT itself.

## Ground Rules

- [x] Create this `FINAL_TODO.md` as the shared implementation checklist.
- [x] Keep JSKIT as the source of truth for workflow state, steps, prompts, receipts, and session files.
- [x] Keep Studio thin: Studio renders JSKIT session JSON and does not own a parallel workflow state machine.
- [x] Do not resurrect the old giant `AGENTS.md` workflow.
- [x] Move useful old workflow discipline into JSKIT-owned session steps, prompt templates, preconditions, receipts, and JSON.
- [x] Keep all new session state filesystem-backed and inspectable under `.jskit/sessions/active/<session_id>/`.
- [x] Keep generated durable app memory under `.jskit/`, not in old free-form workboard files.
- [x] Add tests for every new session transition and every new JSON contract field.

## Explicit Non-Goals

- [x] Do not make issue sessions reason about `empty`, `non_jskit_repo`, or `partial_jskit_app` as normal states.
- [x] Do not make Codex recover arbitrary non-JSKIT directories inside the issue workflow.
- [x] If a session is somehow started before app setup/app bootup readiness, JSKIT should block with a setup-required error rather than asking Codex to reason about recovery.
- [x] Do not add a project picker, app registry, or multi-project behavior.
- [x] Do not add a Studio-owned session workflow.
- [x] Do not reintroduce `.jskit/WORKBOARD.md`.
- [x] Do not make `AGENTS.md` long again.

## Current Groundwork Already In Place

- [x] `jskit session --json` exposes `stepDefinitions`, `currentStepAction`, Codex handoff metadata, receipts, issue text, PR URL, and session state.
- [x] Studio can render the session timeline from JSKIT-owned step definitions.
- [x] Session state lives in `.jskit/sessions/active/<session_id>/`.
- [x] Completed and abandoned sessions are archived into separate filesystem directories.
- [x] Worktrees live inside the owning session directory.
- [x] `jskit helper-map update` exists as a JSKIT-owned helper map utility.
- [x] The helper map is generated into `.jskit/helper-map.json` and `.jskit/helper-map.md`.
- [x] Helper map generation uses parser-backed export discovery instead of regex-only parsing.
- [x] Helper map update is integrated into the existing `Branch pushed, PR created` step.
- [x] Existing prompts already mention `.jskit/helper-map.md` in planning/review contexts.

## Desired High-Level Session Shape

The final visible issue session should move through this broad sequence:

- [x] Session created.
- [x] Worktree created.
- [x] Dependencies installed.
- [x] Initial issue prompt rendered.
- [x] Issue drafted.
- [x] GitHub issue created.
- [x] Get issue details prompt rendered.
- [x] Issue details gathered.
- [x] Plan made.
- [x] Plan fine tuning.
- [x] Implementation changes accepted.
- [x] Implementation changes committed.
- [x] Pre-review checks run.
- [x] Deep UI check run or skipped.
- [x] Deslop/JSKIT review run.
- [x] Review changes accepted.
- [x] Review changes committed.
- [x] Post-review checks run.
- [x] Deep UI re-check run or skipped.
- [x] User check completed.
- [x] If user check fails, optionally start a new rework cycle at Plan fine tuning.
- [x] Blueprint updated.
- [x] Final verification run.
- [x] Final report created and commented.
- [x] Branch pushed and PR created.
- [x] PR finalized with an explicit outcome, base updated when merged, worktree removed.
- [x] Session finished and archived.

## New And Revised Session Artifacts

- [x] Add `.jskit/sessions/active/<session_id>/issue_details.md`.
- [x] Add `.jskit/sessions/active/<session_id>/issue_metadata.json`.
- [x] Add `.jskit/sessions/active/<session_id>/agent_decisions.md`.
- [x] Add `.jskit/sessions/active/<session_id>/final_report.md`.
- [x] Add `.jskit/sessions/active/<session_id>/github_comments.json` for idempotent GitHub issue comments.
- [x] Add `.jskit/sessions/active/<session_id>/base_branch` captured when the session worktree is created.
- [x] Add `.jskit/sessions/active/<session_id>/base_commit` captured when the session worktree is created.
- [x] Add session workflow version metadata to the existing session manifest/state file.
- [x] Add `.jskit/sessions/active/<session_id>/active_cycle` as a plain text current cycle marker.
- [x] Add `.jskit/sessions/active/<session_id>/cycles/cycle_###/rework_request.md` for user-requested rework notes.
- [x] Add cycle-scoped text receipts under `.jskit/sessions/active/<session_id>/steps/cycle_###/<step_id>`.
- [x] Add `.jskit/sessions/active/<session_id>/command_log.jsonl` if ordinary command execution needs durable command/output history beyond receipts.
- [x] Add `.jskit/sessions/active/<session_id>/checks/` for structured check receipts.
- [x] Add `.jskit/sessions/active/<session_id>/ui_checks/` for structured UI review/check receipts.
- [x] Add `.jskit/sessions/active/<session_id>/review_passes/` for repeated deslop/JSKIT review passes.
- [x] Keep `.jskit/APP_BLUEPRINT.md` as durable app memory.
- [x] Keep `.jskit/helper-map.md` as generated helper/export memory.
- [x] Make every artifact path appear in `jskit session <id> --json` when it exists.

## Naming Decision: Issue Details

- [x] Use `issue_details.md` as the canonical accepted details file.
- [x] Treat `Get issue details` as the human-facing step label, because the developer is clarifying the issue with Codex.
- [x] Do not create a separate long-lived `issue_details.md` unless a compatibility alias is explicitly needed later.
- [x] The execution prompt must tell Codex to follow both `plan.md` and `issue_details.md`.
- [x] Any GitHub issue comment for the details step should post the accepted contents of `issue_details.md`.

## App Readiness Boundary

- [x] Treat app boot/app setup as the owner of empty/non-JSKIT/partial-JSKIT recovery.
- [x] Before issue work begins, JSKIT session should verify the target looks like a ready JSKIT app.
- [x] If readiness is missing, return a stable blocked error such as `app_setup_required`.
- [x] The repair guidance should tell Studio/CLI users to run the app setup flow, not ask Codex to recover the app inside an issue session.
- [x] Add tests that a non-ready app blocks before issue prompt rendering.
- [x] Add tests that issue prompts no longer ask Codex to plan recovery for empty or partial apps.

## Session Workflow Versioning

Goal: avoid corrupting or misrendering sessions created by an older step graph.

- [x] Assign a stable workflow version to all newly created sessions.
- [x] Include workflow version in session JSON.
- [x] Do not support legacy workflow versions; hard-block them with `unsupported_workflow_version`.
- [x] Do not silently map old step ids onto new semantics.
- [x] Add tests for creating a new-version session.
- [x] Add tests that an unsupported old workflow version blocks inspection/advancement without corrupting files.

## JSON Contract Additions

- [x] Add `appReady` or equivalent setup-readiness status if JSKIT session must block before issue work.
- [x] Add `workflowVersion`.
- [x] Add `baseBranch`.
- [x] Add `baseCommit`.
- [x] Add `activeCycle`.
- [x] Add `cycles[]` with cycle number, status, rework request path, and user-check result.
- [x] Add `issueMetadata`.
- [x] Add `issueDetails` as a string.
- [x] Add `issueDetailsPath` as a string.
- [x] Add `issueCategory` with allowed values: `client`, `server`, `client_server`, `tooling`, `unknown`.
- [x] Add `uiImpact` with allowed values: `none`, `possible`, `definite`, `unknown`.
- [x] Add `agentDecisionsPath`.
- [x] Add `agentDecisionsSummary` or `agentDecisionsLatest`.
- [x] Add `blueprintPath`.
- [x] Add `blueprintExists`.
- [x] Add `helperMapPath`.
- [x] Add `helperMapExists`.
- [x] Add `finalReportPath`.
- [x] Add `finalReportText`.
- [x] Add `githubComments[]` or comment receipt metadata so Studio can show which issue comments have been posted.
- [x] Add `checks[]` with stable objects for automated checks.
- [x] Add `uiChecks[]` with stable objects for UI/deep UI checks.
- [x] Add `reviewPasses[]` with pass number, status, commit, changed files, and prompt path.
- [x] Add optional `stepDefinitions[].displayGroupId` and `stepDefinitions[].displayGroupLabel` for JSKIT-owned visual grouping of related steps.
- [x] Add `currentStepAction.conditional` for steps that can skip.
- [x] Add `currentStepAction.skipReason` when JSKIT can determine why a conditional step is skipped.
- [x] Add `currentStepAction.retryable` for blocked check/review/UI steps that should rerun after repair.
- [x] Add `currentStepAction.alternateActions[]` for precise allowed transitions such as failed user-check rework.
- [x] Ensure `currentStepAction.label` is the source of truth for Studio button text.
- [x] Ensure `currentStepAction.requiredInput` describes when an action is disabled until parsed/edited output is valid.
- [x] Ensure `--json` writes only JSON to stdout.
- [x] Contract-test all new fields on active, completed, abandoned, and blocked sessions.

## Step: Initial Issue Prompt

Goal: create a first implementation-ready issue draft from the user's short request, without mutating the project.

- [x] Update `new_issue.md` to assume app setup already passed.
- [x] Remove normal reasoning around `empty`, `non_jskit_repo`, and `partial_jskit_app`.
- [x] Add instruction: if the filesystem contradicts a valid JSKIT app, report setup failure instead of inventing recovery work.
- [x] Instruct the agent to read `.jskit/APP_BLUEPRINT.md` when present.
- [x] Instruct the agent to read `.jskit/helper-map.md` when present.
- [x] Instruct the agent to inspect `package.json`, `.jskit/lock.json`, `config/public.js`, relevant `src/`, and relevant `packages/`.
- [x] Mention safe read-only commands: `pwd`, `ls`, `find`, `rg`, `cat`, `sed`, `git status`.
- [x] Mention safe JSKIT inspection commands only when available and non-mutating:
  - [x] `jskit list`
  - [x] `jskit show <package> --details`
  - [x] `jskit list-placements`
- [x] Keep mutation commands forbidden in issue drafting:
  - [x] no `jskit session step`
  - [x] no `gh`
  - [x] no `git add`
  - [x] no `git commit`
  - [x] no `git push`
  - [x] no `npm install`
  - [x] no generators
  - [x] no tests
  - [x] no doctor
- [x] Keep output tags:
  - [x] `[issue_title]...[/issue_title]`
  - [x] `[issue_text]...[/issue_text]`
- [x] Test that issue drafting remains read-only by prompt contract.
- [x] Test that generated issue prompt mentions blueprint/helper-map/app inspection.

## GitHub Issue Creation Metadata

Goal: make the created GitHub issue a durable session fact that later steps can safely depend on.

- [x] Keep issue title and body editable after Codex drafts them and before GitHub creation.
- [x] Disable issue creation until both title and body are valid parsed/edited values.
- [x] Create the GitHub issue through JSKIT session runtime, not Studio-owned GitHub logic.
- [x] Write `issue_metadata.json` when the GitHub issue is created.
- [x] Store issue number, URL, repository owner/name, title, and body in `issue_metadata.json`.
- [x] Keep issue creation idempotent when rerun after metadata already exists.
- [x] Add issue metadata to session JSON.
- [x] Add tests that edited title/body are what get sent to GitHub.
- [x] Add tests that rerunning issue creation does not create duplicate issues.

## New Step: Get Issue Details

Goal: let the developer and Codex talk until no important issue details are missing, before planning begins.

### Step Shape

- [x] Add JSKIT session step after `issue_created` and before `plan_made`.
- [x] Fold issue-detail prompt rendering into `issue_details_gathered`; do not expose a separate checklist step.
- [x] Use button label `Start details conversation` from the JSKIT Codex handoff before details are available.
- [x] Add internal step `issue_details_gathered`.
- [x] Use visible label `Issue details gathered` for `issue_details_gathered`.
- [x] Use button label `Save issue details` for `issue_details_gathered`.
- [x] Keep the details flow as one visible CLI/Studio step; prompt rendering is a phase of `issue_details_gathered`, not a separate timeline item.
- [x] Keep JSKIT-owned display group metadata on `issue_details_gathered` so Studio can render it as the issue-details area without owning the step ID.
- [x] Preserve a clean manual CLI flow.
- [x] Preserve Studio's 1:1 rendering of JSKIT-owned steps.
- [x] Add prompt artifact path: `prompts/issue_details.md`.
- [x] Add accepted details file: `issue_details.md`.
- [x] Add metadata file: `issue_metadata.json`.
- [x] Append important decisions to `agent_decisions.md`.
- [x] Comment accepted issue details on the GitHub issue.

### Prompt Behavior

- [x] Create `tooling/jskit-cli/src/server/sessionRuntime/prompts/issue_details.md`.
- [x] The prompt must tell Codex: "No stones unturned."
- [x] Codex must read:
  - [x] GitHub issue URL and issue text.
  - [x] `.jskit/APP_BLUEPRINT.md`.
  - [x] `.jskit/helper-map.md`.
  - [x] `package.json`.
  - [x] `.jskit/lock.json`.
  - [x] `config/public.js`.
  - [x] relevant `src/` and `packages/`.
  - [x] relevant JSKIT package docs or `jskit show ... --details`.
- [x] Codex must ask follow-up questions until issue details are complete.
- [x] Codex must ask for final confirmation before emitting final details.
- [x] Codex must not edit files during this step.
- [x] Codex must not run mutation commands during this step.

### Required Detail Areas

- [x] If CRUD or persisted data is involved, require:
  - [x] entity/table name.
  - [x] field names.
  - [x] field types.
  - [x] required/optional/nullability.
  - [x] defaults.
  - [x] uniqueness.
  - [x] indexes where relevant.
  - [x] relationships.
  - [x] ownership: `public`, `user`, `workspace`, `workspace_user`, or explicit exception.
  - [x] allowed operations: `list`, `view`, `new`, `edit`, `delete`, or narrower set.
  - [x] list fields.
  - [x] view form shape.
  - [x] edit/new form shape.
  - [x] validation rules.
  - [x] permissions and role boundaries.
  - [x] migration/generator lane.
  - [x] exact CRUD generator command or exact reason no CRUD generator applies.
- [x] If UI is involved, require:
  - [x] route path.
  - [x] placement/surface target.
  - [x] navigation entry expectations.
  - [x] responsive layout expectations.
  - [x] loading state.
  - [x] empty state.
  - [x] error state.
  - [x] disabled state.
  - [x] success state.
  - [x] Material/Vuetify quality expectations.
  - [x] Playwright verification path.
  - [x] auth/bootstrap strategy if login is needed.
- [x] If server-only work is involved, require:
  - [x] endpoint/command/job shape.
  - [x] request and response shape.
  - [x] validation behavior.
  - [x] auth/permission behavior.
  - [x] persistence ownership if any.
  - [x] error behavior.
  - [x] verification path.
- [x] If package/generator work is involved, require:
  - [x] exact `jskit add` or `jskit generate` command.
  - [x] reason the package/generator applies.
  - [x] expected generated files.
  - [x] follow-up custom code areas.
- [x] If the request is intentionally tiny, still require:
  - [x] exact file/path behavior.
  - [x] acceptance criteria.
  - [x] whether UI is impacted.
  - [x] whether tests/checks are needed.

### Required Output Tags

- [x] Require Codex to output:

```text
[issue_category]
client | server | client_server | tooling
[/issue_category]

[ui_impact]
none | possible | definite
[/ui_impact]

[issue_details]
<confirmed issue details in Markdown>
[/issue_details]

[agent_decisions]
<append-only decision entries with reasons>
[/agent_decisions]
```

- [x] Add parser helpers for these tags.
- [x] Validate allowed `issue_category` values.
- [x] Validate allowed `ui_impact` values.
- [x] Reject empty `issue_details`.
- [x] Save `agent_decisions` by appending to session `agent_decisions.md`.
- [x] Write a receipt when details are saved.
- [x] Add tests for valid output.
- [x] Add tests for missing tags.
- [x] Add tests for invalid category.
- [x] Add tests for invalid UI impact.
- [x] Add tests that issue details are commented on the GitHub issue.

## Dependency Install Step

Goal: make the session worktree runnable before Codex starts inspecting or editing it.

- [x] Capture `base_branch` and `base_commit` when the worktree is created, before dependency installation.
- [x] Keep dependency installation as a JSKIT-owned session step immediately after worktree creation.
- [x] Run dependency installation in the session worktree, not the target root.
- [x] Use the project package manager/lockfile detected from the worktree.
- [x] Do not run `devlinks` as part of normal Studio/session workflow.
- [x] Stream the command output through the same terminal/job mechanism Studio uses for other visible commands.
- [x] Block Codex startup and later issue work until dependency installation succeeds.
- [x] Make the step retryable and idempotent.
- [x] Record command, exit code, and summary in session receipts or `command_log.jsonl`.
- [x] Add dependency-install status to session JSON.
- [x] Add tests that base branch/base commit metadata is captured at worktree creation.
- [x] Add tests that Codex cannot start for a session before dependencies are installed.
- [x] Add tests that rerunning the dependency step is safe.

## Issue Classification

- [x] Store classification in `issue_metadata.json`.
- [x] Include `issueCategory` in session JSON.
- [x] Include `uiImpact` in session JSON.
- [x] Use `uiImpact` to decide whether Deep UI Check steps should run or skip.
- [x] Treat `uiImpact=none` as skip for Deep UI Check.
- [x] Treat `uiImpact=possible` as run unless the user explicitly marks UI not impacted.
- [x] Treat `uiImpact=definite` as mandatory Deep UI Check.
- [x] Add an explicit skip/override path for `uiImpact=possible`, requiring a short reason that is stored in `ui_checks/`.
- [x] Add repair/error behavior when classification is missing before UI/check steps.
- [x] Add Studio display for category and UI impact in the session info cards.

## GitHub Comment Idempotency

Goal: rerunning a step must not spam the GitHub issue with duplicate plan/details/final-report comments.

- [x] Store comment metadata in `github_comments.json`.
- [x] Track comment purpose keys such as `issue_details`, `plan`, and `final_report`.
- [x] Store comment purpose metadata for later display and duplicate suppression.
- [x] If a comment already exists for a purpose, update it when supported or skip with a clear receipt.
- [x] If update is not feasible in V1, skip duplicate comments after the first successful comment and report the stored metadata.
- [x] Add tests that rerunning issue-details comment does not duplicate the issue comment.
- [x] Add tests that rerunning plan comment does not duplicate the issue comment.
- [x] Add tests that rerunning final-report comment does not duplicate the issue comment.

## Agent Decisions Log

Goal: preserve the why behind important choices without resurrecting a workboard.

- [x] Add session-owned `agent_decisions.md`.
- [x] Initialize it with session id, issue URL, and timestamp.
- [x] Append decisions from Get Issue Details.
- [x] Append generator/package decisions from Plan Made.
- [x] Append implementation deviations from Plan Fine Tuning.
- [x] Append Deep UI Check decisions.
- [x] Append verification decisions.
- [x] Append blueprint-update decisions.
- [x] Keep entries concise and reasoned.
- [x] Do not use this as task tracking.
- [x] Do not make it app-global.
- [x] Include latest decision summary in `jskit session <id> --json`.
- [x] Comment the decision log or a summarized decision report on the GitHub issue near the end.
- [x] Add tests that decisions are appended, not overwritten.
- [x] Add tests that the final report links or includes decisions.

## Plan Made Step

Goal: produce an implementation plan only after the issue and details are complete.

- [x] Update `plan_issue.md` to read `issue_details.md`.
- [x] Update `plan_issue.md` to read `agent_decisions.md`.
- [x] Update `plan_issue.md` to read `.jskit/APP_BLUEPRINT.md`.
- [x] Update `plan_issue.md` to read `.jskit/helper-map.md`.
- [x] Require plan to include the issue category and UI impact.
- [x] Require plan to include exact generator/package decisions.
- [x] Require plan to include exact JSKIT inspection commands used or to use.
- [x] For CRUD work, require exact server CRUD command or exact reason not applicable.
- [x] For non-CRUD UI pages, require exact UI generator command or exact reason not applicable.
- [x] For UI-impacting work, require planned Playwright and Deep UI Check path.
- [x] For auth-required UI, require local dev auth/bootstrap strategy.
- [x] Require plan output tags:

```text
[plan]
<implementation plan>
[/plan]

[agent_decisions]
<new decisions from planning>
[/agent_decisions]
```

- [x] Save `plan.md`.
- [x] Append plan decisions to `agent_decisions.md`.
- [x] Comment the approved plan on the GitHub issue immediately after approval.
- [x] Expose JSKIT action metadata that lets Studio label the automated action `Create and submit plan`.
- [x] Expose whether the accepted plan has already been submitted to Codex for implementation.
- [x] Ensure this existing behavior is explicit and tested.
- [x] Add tests that `plan_made` requires `issue_details.md`.
- [x] Add tests that plan comment includes the approved plan.

## Plan Fine Tuning Step

Goal: let the user refine the plan with Codex, then implement in the worktree.

- [x] Update `fine_tune_plan.md` to read `issue_details.md`.
- [x] Update `fine_tune_plan.md` to explicitly say Codex must follow both `plan.md` and `issue_details.md`.
- [x] Update `fine_tune_plan.md` to read `agent_decisions.md`.
- [x] Update prompt to preserve user refinements as decision-log entries.
- [x] Require Codex to append any meaningful implementation deviations to `agent_decisions.md` through tagged output or a session step input.
- [x] Keep Codex from creating commits, PRs, merges, or worktree cleanup.
- [x] Keep Codex working only inside the session worktree.
- [x] Add tests that prompt includes issue details path.
- [x] Add tests that prompt includes decisions path.

## Mutation And Commit Model For Repair / Quality Steps

Goal: every Codex step that can edit files must leave the worktree in a known committed or explicitly accepted state before the workflow advances.

- [x] Define which prompt steps are allowed to mutate files.
- [x] Treat Plan Fine Tuning / implementation as mutating.
- [x] Treat Deep UI Check as mutating when it fixes scoped UI issues.
- [x] Treat Deslop/JSKIT review as mutating when it fixes findings.
- [x] Treat check/doctor repair prompts as mutating when they fix failures.
- [x] After any mutating Codex quality/repair step, require an accept/commit path before proceeding.
- [x] Avoid leaving dirty worktree changes between quality/check steps unless the next step explicitly owns those dirty changes.
- [x] Include dirty-worktree status in `jskit session <id> --json`.
- [x] Expose changed files and a JSKIT-owned diff utility path for acceptance steps.
- [x] Acceptance steps should let Studio show the current branch/worktree diff before the user accepts changes.
- [x] Add a generic commit helper for session-owned quality/repair commits where possible.
- [x] Commit messages should identify the session and phase, for example `Deep UI check fixes for <session_id>`.
- [x] Add tests that Deep UI Check changes are committed or explicitly skipped before deslop/review advances.
- [x] Add tests that check-repair changes are committed before rerunning the check step.
- [x] Add tests that repeated review pass changes are committed per pass.

## Repeated Deslop / JSKIT Review

Goal: support multiple deslop/JSKIT review passes without hard-coding three duplicated visible step groups.

- [x] Design repeatable review pass storage under `review_passes/<n>/`.
- [x] Keep the visible step model simple.
- [x] Avoid reintroducing separate numbered visible steps such as `review_prompt_rendered_1`, `review_prompt_rendered_2`, etc.
- [x] Add `reviewPasses[]` to JSON.
- [x] Add current review pass number to JSON.
- [x] Add maximum review pass setting with a conservative default.
- [x] Add prompt support for "run another deslop/JSKIT review pass".
- [x] Keep Deslop and JSKIT review as distinct sections in the prompt.
- [x] Deslop checks:
  - [x] duplicate helpers.
  - [x] unnecessary helpers.
  - [x] fake-complete UI.
  - [x] missing states.
  - [x] dead code.
  - [x] weak route wiring.
  - [x] placeholder copy/code.
- [x] JSKIT checks:
  - [x] wrong generator choice.
  - [x] missed package/runtime seam.
  - [x] hand-built CRUD where generated ownership is required.
  - [x] direct knex outside approved lanes.
  - [x] metadata drift.
  - [x] surface/route/ownership mistakes.
- [x] Add a way to stop review passes when no important findings remain.
- [x] Add a way to request another pass when important findings remain.
- [x] Ensure each review pass that changes files has an accept/commit path before the next pass.
- [x] Ensure each review pass records the commit SHA or records that no changes were needed.
- [x] Add tests for zero-change review pass.
- [x] Add tests for review pass with changes.
- [x] Add tests for max pass handling.

## Automated Checks Before And After Review

Goal: make checks a first-class session concept, not only an afterthought.

- [x] Add step before review/deslop: `pre_review_checks_run`.
- [x] Add step after review/deslop: `post_review_checks_run`.
- [x] Use button label `Run checks` for `pre_review_checks_run`.
- [x] Use button label `Run checks again` for `post_review_checks_run`.
- [x] Run the smallest relevant automated checks for the current project.
- [x] Prefer existing project script order:
  - [x] `npm run verify:local` if present.
  - [x] else `npm run verify` if present.
  - [x] else `npx jskit app verify`.
  - [x] else known fallback scripts if appropriate. No additional fallback is currently appropriate beyond JSKIT verification.
- [x] Store stdout/stderr summaries under `checks/`.
- [x] Store structured status in JSON.
- [x] If pre-review checks fail, block and render repair prompt.
- [x] If post-review checks fail, block and render repair prompt.
- [x] If a repair prompt changes files, commit the repair before rerunning the same check.
- [x] After repair, rerun the same check step rather than arbitrary jumping.
- [x] Avoid generic arbitrary state-machine jumping in V1.
- [x] Add tests for passing pre-review checks.
- [x] Add tests for failing pre-review checks.
- [x] Add tests for passing post-review checks.
- [x] Add tests for failing post-review checks.
- [x] Add tests that blocked check steps are retryable.

## Deep UI Check Before And After Review

Goal: add a focused UI quality pass for visual/client-impacting work.

- [x] Add step before deslop/review: `deep_ui_check_run`.
- [x] Add step after deslop/review: `deep_ui_recheck_run`.
- [x] Use `uiImpact` to decide run/skip.
- [x] If `uiImpact=none`, write a skipped receipt with reason.
- [x] If `uiImpact=possible`, run unless explicitly overridden.
- [x] If `uiImpact=definite`, require run.
- [x] Create prompt `deep_ui_check.md`.
- [x] The prompt must inspect changed UI files, routes, components, layouts, and screenshots if available.
- [x] Changed UI files should be derived from the session branch diff against the target base branch, not only the latest commit.
- [x] Use the captured `baseBranch`/`baseCommit` metadata for branch-wide changed-file calculations.
- [x] The prompt must check:
  - [x] Material Design quality.
  - [x] Vuetify best practices.
  - [x] visual hierarchy.
  - [x] spacing.
  - [x] responsive behavior.
  - [x] loading states.
  - [x] empty states.
  - [x] error states.
  - [x] disabled states.
  - [x] success states.
  - [x] accessibility basics.
  - [x] route/navigation coherence.
  - [x] consistency with existing app style.
- [x] The prompt must ask Codex to fix scoped UI issues when clear.
- [x] The prompt must not create commits or PRs.
- [x] If the Deep UI Check fixes files, require accept/commit before continuing.
- [x] If the Deep UI Re-check fixes files, require accept/commit before continuing.
- [x] Integrate Playwright guidance:
  - [x] run a meaningful route check when possible.
  - [x] use local dev auth bootstrap when needed.
  - [x] record UI verification with `jskit app verify-ui`.
  - [x] call out missing auth bootstrap as a testability gap.
- [x] Store UI check output under `ui_checks/`.
- [x] Include UI check status in JSON.
- [x] Add tests for skipped server-only issue.
- [x] Add tests for mandatory UI-impact issue.
- [x] Add tests for the Deep UI check prompt/accept/commit repair flow.
- [x] Add Studio rendering for skipped/running/passed/failed UI checks.

## User Check Step

Goal: keep human verification as a distinct step.

- [x] Keep existing `user_check_completed` step.
- [x] Update prompt to mention issue details and planned acceptance criteria.
- [x] Tell user exactly what route, behavior, command, or workflow to inspect.
- [x] If user reports pass, write a passed receipt for the active cycle.
- [x] If user reports failure, write a failed receipt for the active cycle and expose the precise rework action.
- [x] Include user check result in final report.
- [x] Add tests for failed user check path if not already covered.

## Allowed Rework Cycle From Failed User Check

Goal: allow meaningful rework without arbitrary jumping or receipt deletion.

- [x] Do not add a generic "jump to any step" API.
- [x] Add exactly one V1 allowed back-transition: failed User Check can return to Plan fine tuning.
- [x] Treat this as starting a new implementation cycle, not rewinding the session.
- [x] Keep setup/planning receipts global and one-time:
  - [x] `steps/session_created`
  - [x] `steps/worktree_created`
  - [x] `steps/dependencies_installed`
  - [x] `steps/issue_prompt_rendered`
  - [x] `steps/issue_drafted`
  - [x] `steps/issue_created`
  - [x] `steps/issue_details_gathered`
  - [x] `steps/plan_made`
- [x] Store implementation-and-review receipts under the active cycle:
  - [x] `steps/cycle_001/plan_fine_tuning`
  - [x] `steps/cycle_001/implementation_changes_accepted`
  - [x] `steps/cycle_001/implementation_changes_committed`
  - [x] `steps/cycle_001/pre_review_checks_run`
  - [x] `steps/cycle_001/deep_ui_check_run`
  - [x] `steps/cycle_001/review_prompt_rendered`
  - [x] `steps/cycle_001/review_changes_accepted`
  - [x] `steps/cycle_001/review_changes_committed`
  - [x] `steps/cycle_001/post_review_checks_run`
  - [x] `steps/cycle_001/deep_ui_recheck_run`
  - [x] `steps/cycle_001/user_check_completed`
- [x] If user check fails, write the active cycle receipt as failed text, not as a completed pass.
- [x] Require rework notes before starting the next cycle.
- [x] Save rework notes as plain markdown under `cycles/cycle_###/rework_request.md`.
- [x] Increment `active_cycle` and return `currentStep` to `plan_fine_tuning`.
- [x] Make Plan fine tuning read the latest rework request when cycle number is greater than 1.
- [x] Keep previous cycle receipts visible as history and exclude them from current-step completion.
- [x] Compute current workflow truth from global receipts plus the active cycle's receipts.
- [x] Allow finalization steps only after the active cycle has a passed user check.
- [x] Add a stable CLI path, for example `jskit session <id> step --user-check failed --rework-notes -`.
- [x] Add a stable Studio action label such as `Return to Plan fine tuning`.
- [x] Add tests that failed user check does not delete or overwrite prior receipts.
- [x] Add tests that a second cycle starts at Plan fine tuning with the rework request available to the prompt.
- [x] Add tests that finalization is blocked while the active cycle user check is failed or missing.
- [x] Add tests that previous cycle history is still exposed in session JSON.

## Blueprint Updated Step

Goal: enrich durable app memory issue by issue.

### Step Position

- [x] Add `blueprint_updated` after user check and review/check cycles.
- [x] Run it before final verification/doctor and before PR creation.
- [x] Ensure blueprint changes are included in the session branch.
- [x] Commit blueprint changes if changed.
- [x] If blueprint is unchanged, write an unchanged receipt.

### Prompt Behavior

- [x] Create prompt `update_blueprint.md`.
- [x] Prompt reads:
  - [x] current `.jskit/APP_BLUEPRINT.md` if present.
  - [x] issue title/body.
  - [x] issue details.
  - [x] approved plan.
  - [x] agent decisions.
  - [x] changed files.
  - [x] helper map.
  - [x] package/app metadata.
- [x] Prompt updates only durable app/product/architecture memory.
- [x] Changed files should be derived from the whole session branch diff against the target base branch.
- [x] Use the captured `baseBranch`/`baseCommit` metadata for the blueprint changed-file list.
- [x] Prompt must not include session task tracking.
- [x] Prompt must not recreate `.jskit/WORKBOARD.md`.
- [x] Prompt must not over-expand tiny issues into broad product rewrites.
- [x] Prompt should naturally evolve from a minimal app sketch to a richer app blueprint over many issues.
- [x] Prompt output tag:

```text
[app_blueprint]
<full updated blueprint markdown>
[/app_blueprint]
```

### Runtime Behavior

- [x] Parse `[app_blueprint]`.
- [x] Write `.jskit/APP_BLUEPRINT.md`.
- [x] If changed, commit with a clear message.
- [x] Append blueprint decision summary to `agent_decisions.md`.
- [x] Add blueprint update receipt.
- [x] Add blueprint status to JSON.
- [x] Add tests for creating a new blueprint.
- [x] Add tests for updating an existing blueprint.
- [x] Add tests for unchanged blueprint.
- [x] Add tests that blueprint update happens before final verification.
- [x] Add CLI/session input support for accepting the tagged blueprint output, for example `--blueprint -` or a step-specific equivalent.
- [x] Add tests for invalid/missing `[app_blueprint]` output.

## Final Verification / Doctor

Goal: verify the full branch after implementation, review, UI checks, and blueprint update.

- [x] Keep existing final verification step.
- [x] Ensure final verification runs after blueprint update.
- [x] Ensure final verification sees all committed changes.
- [x] Ensure UI receipt expectations are respected when UI files changed.
- [x] Keep doctor failures repairable.
- [x] Update doctor failure prompt to mention:
  - [x] issue details.
  - [x] blueprint update.
  - [x] helper map.
  - [x] UI checks.
  - [x] check receipts.
- [x] Add tests that final verification runs after blueprint update.
- [x] Add tests that final verification failure blocks PR creation.

## Final Report Step

Goal: generate a clear final report for the issue before PR/merge completion.

- [x] Add step `final_report_created`.
- [x] Position it after final verification and before branch push / PR creation.
- [x] Do not require the PR URL in this report; the later final comment can include PR URL after creation/merge.
- [x] Generate the final report deterministically from session artifacts in V1.
- [x] Do not make final report generation depend on another Codex prompt in V1.
- [x] Keep `final_report.md` as a session artifact, not an app-branch file to commit.
- [x] Report must include:
  - [x] issue URL.
  - [x] issue title.
  - [x] issue details summary.
  - [x] plan summary.
  - [x] files changed.
  - [x] commits.
  - [x] commands/checks run.
  - [x] UI checks run or skipped.
  - [x] Playwright/verify-ui status.
  - [x] user check result.
  - [x] blueprint update status.
  - [x] helper map status if available, or a note that helper map refresh happens during PR creation.
  - [x] remaining unverified gaps.
  - [x] important decisions and why.
- [x] Write `final_report.md`.
- [x] Comment final report on the GitHub issue.
- [x] Include final report path/text in JSON.
- [x] Add tests that final report is created.
- [x] Add tests that final report is commented on issue.
- [x] Add tests that final report includes checks and UI checks.

## Branch Pushed And PR Created Step

Goal: keep PR creation as the single visible step that finalizes branch publication.

- [x] Keep helper map update inside this step.
- [x] Ensure helper map changes are committed before push.
- [x] Ensure blueprint changes have already been committed before push.
- [x] Ensure final report has already been created/commented or intentionally recorded before push.
- [x] Ensure branch push includes all final commits.
- [x] Create PR with issue body and "Closes #".
- [x] Preserve existing GitHub auth/remote preconditions.
- [x] Keep behavior idempotent when PR already exists if possible.
- [x] Add tests that helper map commit occurs before push.
- [x] Add tests that blueprint commits are present before push.
- [x] Add tests that final report receipts/comments exist before push.

## PR Finalized / Worktree Removed Step

Goal: merge safely when requested, allow successful completion without merge, clean worktree, and preserve recoverability.

- [x] Preserve current already-merged PR handling.
- [x] Preserve current target-root dirty check.
- [x] Preserve current base branch fast-forward checks.
- [x] Preserve issue close/comment behavior.
- [x] Preserve branch recoverability where possible.
- [x] Preserve worktree cleanup.
- [x] Add successful `closed_without_merge` outcome.
- [x] Require a close-without-merge reason.
- [x] Leave the PR open for maintainer review/merge when closing the local session without merge.
- [x] Expose merge and finish-without-merge as PR finalization choices for Studio.
- [x] Store PR finalization outcome in session JSON.
- [x] Add tests for completed sessions that finish without merge.
- [x] Ensure final session archive includes:
  - [x] workflow version metadata.
  - [x] active cycle marker.
  - [x] all cycle directories and rework requests.
  - [x] issue metadata.
  - [x] base branch and base commit metadata.
  - [x] final report.
  - [x] agent decisions.
  - [x] issue details.
  - [x] GitHub comment metadata.
  - [x] check receipts.
  - [x] UI check receipts.
  - [x] command log if present.
  - [x] prompt artifacts.
- [x] Add tests for archive contents.

## Studio Integration

Goal: update Studio only after JSKIT JSON supports the workflow.

- [x] Do not hard-code new step IDs in Studio beyond generic rendering needs.
- [x] Render `issueDetails`.
- [x] Render `issueCategory`.
- [x] Render `uiImpact`.
- [x] Render `agentDecisions` card/link.
- [x] Render `finalReport` card/link.
- [x] Render `checks[]`.
- [x] Render `uiChecks[]`.
- [x] Render `reviewPasses[]`.
- [x] Render `cycles[]` and active cycle status.
- [x] Render repeatable cycle cues on affected todo rows instead of adding a separate summary panel.
- [x] Render the JSKIT diff viewer/button on implementation/review/check acceptance steps.
- [x] Support conditional skipped steps visually.
- [x] Support retryable blocked steps visually.
- [x] Render allowed alternate actions from `currentStepAction.alternateActions[]`.
- [x] Submit alternate actions through JSKIT-provided `submitOptions` metadata.
- [x] For failed user check, render the rework notes input inside the User Check step.
- [x] Use `currentStepAction.label` for step buttons instead of Studio-owned labels.
- [x] Hide output editor/forms until JSKIT has parsed candidate output for that step.
- [x] Disable action buttons until `currentStepAction.requiredInput` is satisfied.
- [x] In `Get issue details`, render the Codex conversation and output form inside the step.
- [x] Treat Codex prompt-render steps and Codex output-save steps separately so starting the details conversation does not look like saving the details.
- [x] In `Plan made`, include issue details context.
- [x] In Deep UI Check steps, show run/skip status clearly.
- [x] Ensure terminal remains below/alongside todo according to current Studio layout.
- [x] Ensure mobile layout keeps Codex terminal usable and collapsible.
- [x] Ensure abandoned/completed session views show final report and decisions.
- [ ] Add tests or browser checks for the new Studio rendering.
- [ ] Add browser checks that editor/forms are hidden until parsed output exists.
- [x] Add browser checks that invalid/incomplete parsed output keeps the action disabled.

## Prompt Inventory

- [x] Update `new_issue.md`.
- [x] Add `issue_details.md`.
- [x] Update `plan_issue.md`.
- [x] Update `fine_tune_plan.md`.
- [x] Add or update `deep_ui_check.md`.
- [x] Update `review_changes.md`.
- [x] Update `user_check.md`.
- [x] Add `update_blueprint.md`.
- [x] Update `doctor_failure.md`.
- [x] Update `pr_failure.md` if needed.
- [x] Add a deterministic final report renderer; do not add a Codex prompt for final report in V1.
- [x] Update `final_comment.md` if needed.
- [x] Ensure all prompts mention the correct session-owned files.
- [x] Ensure no prompt tells Codex to create `.jskit/WORKBOARD.md`.
- [x] Ensure no prompt tells Codex to use old long `AGENTS.md` workflow.

## Prompt Knowledge Migration

Goal: keep the useful old agent guidance, but move it into JSKIT-owned prompts and patterns instead of long app `AGENTS.md` files.

- [x] Review the pre-Studio AGENTS-linked markdown history.
- [x] Map each useful rule to a current session prompt, JSKIT pattern doc, precondition, or receipt.
- [x] Drop advice that only supported the retired workboard workflow.
- [x] Drop advice that asks Codex to manually duplicate JSKIT session steps.
- [x] Keep `packages/agent-docs/templates/app/AGENTS.md` short and generic.
- [x] Ensure app `AGENTS.md` points agents to `jskit session` and does not contain the old workflow.
- [x] Add tests that generated app AGENTS does not reference deleted workflow files.
- [x] Add tests or docs checks that all current prompt files reference the canonical session artifacts by name.

## CLI And Parser Work

- [x] Add input resolution for `--issue-details`, `--issue-details-file`, and `--issue-details -`.
- [x] Add input resolution for `--issue-category`.
- [x] Add input resolution for `--ui-impact`.
- [x] Add input resolution for conditional UI check override, for example `--skip-ui-check --skip-reason "<reason>"`.
- [x] Add input resolution for decision log fragments if needed.
- [x] Add input resolution for blueprint update output, for example `--blueprint`, `--blueprint-file`, and `--blueprint -`.
- [x] Add extraction helpers:
  - [x] `extractIssueCategory`.
  - [x] `extractUiImpact`.
  - [x] `extractIssueDetails`.
  - [x] `extractAgentDecisions`.
  - [x] `extractAppBlueprint`.
- [x] Ensure tagged-output extraction ignores Codex terminal/status chrome and uses complete marker pairs only.
- [x] If multiple complete tagged blocks exist, define and test whether JSKIT uses the first or latest complete block.
- [x] Add validators for enum values.
- [x] Add stable error codes for invalid issue details output.
- [x] Add stable error codes for missing classification.
- [x] Add stable error codes for missing details.
- [x] Add stable repair commands for each new blocked state.

## Preconditions

- [x] Add `dependencies_installed`.
- [x] Add `active_cycle_exists`.
- [x] Add `active_cycle_user_check_passed` for finalization steps.
- [x] Add `issue_details_exists`.
- [x] Add `issue_metadata_exists`.
- [x] Add `plan_text_exists` if not already present.
- [x] Add separate preconditions for `pre_review_checks_passed` and `post_review_checks_passed` where needed.
- [x] Add separate preconditions for `deep_ui_check_satisfied` and `deep_ui_recheck_satisfied` where needed.
- [x] Add `blueprint_update_satisfied`.
- [x] Add `final_report_exists`.
- [x] Add named precondition tests for every new executable step.
- [x] Ensure every step except `session_created` declares named preconditions.

## Receipts

- [x] Add receipt for dependencies installed.
- [x] Add support for global one-time text receipts and cycle-scoped text receipts.
- [x] Add receipt for failed user check in the active cycle.
- [x] Add receipt for starting a new rework cycle.
- [x] Add receipt for issue details prompt rendered.
- [x] Add receipt for issue details saved.
- [x] Add receipt for issue details commented on issue.
- [x] Add receipt for plan commented on issue.
- [x] Add receipt or metadata for idempotent GitHub comment skip/update.
- [x] Add receipt for pre-review checks run.
- [x] Add receipt for Deep UI Check run/skipped.
- [x] Add receipt for review pass run.
- [x] Add receipt for post-review checks run.
- [x] Add receipt for Deep UI Re-check run/skipped.
- [x] Add receipt for blueprint updated/unchanged.
- [x] Add receipt for final report created.
- [x] Add receipt for final report commented on issue.
- [x] Add tests that receipts are readable and archive with session.

## Tests

- [x] Add tests for new issue details tag extraction.
- [x] Add tests for workflow version creation and unsupported-version blocking.
- [x] Add tests for dependency installation receipts and JSON.
- [x] Add tests for base branch/base commit metadata.
- [x] Add tests for active cycle marker creation.
- [x] Add tests for cycle-scoped receipt reading and current-step calculation.
- [x] Add tests for issue metadata creation and JSON.
- [x] Add tests for tagged issue title/body extraction from noisy Codex terminal output.
- [x] Add tests for issue details CLI stdin handling.
- [x] Add tests for issue details prompt rendering.
- [x] Add tests for issue details GitHub comment.
- [x] Add tests for issue classification JSON fields.
- [x] Add tests for plan requiring issue details.
- [x] Add tests for plan comment on GitHub issue.
- [x] Add tests for agent decision append behavior.
- [x] Add tests for repeated review pass bookkeeping.
- [x] Add tests for pre-review checks.
- [x] Add tests for post-review checks.
- [x] Add tests for Deep UI Check run.
- [x] Add tests for Deep UI Check skipped.
- [x] Add tests for blueprint update.
- [x] Add tests for final verification order.
- [x] Add tests for final report generation.
- [x] Add tests for final report GitHub comment.
- [x] Add tests for PR creation including blueprint/helper-map commits and final-report receipt/comment metadata.
- [x] Add tests for completed archive contents.
- [x] Add tests for idempotent GitHub comments.
- [x] Add tests for dirty-worktree blocking between quality/check phases.
- [x] Add tests for failed user check starting a new rework cycle.
- [x] Add tests for rework notes appearing in the next Plan fine tuning prompt.
- [x] Add tests that finalization requires a passed user check in the active cycle.
- [x] Update generated docs/reference tests if command exports change.
- [x] Run focused session tests.
- [x] Run `npm run lint`.
- [x] Run `npm run check:runtime-deps`.
- [x] Run broader `npm run verify:local` when the implementation is ready.

## Documentation

- [x] Update `revolution.md` or replace with a current implementation tracker if appropriate.
- [x] Update CLI help for new session flags.
- [x] Update generated command reference through `npm run agent-docs:build`.
- [x] Update agent docs tests that assert old workflow files are not active.
- [x] Keep `packages/agent-docs/templates/app/AGENTS.md` tiny.
- [x] Document the new Get Issue Details / `issue_details.md` flow.
- [x] Document `agent_decisions.md`.
- [x] Document blueprint enrichment.
- [x] Document conditional Deep UI Check behavior.
- [x] Document the allowed User Check rework cycle and cycle-scoped receipt layout.

## Acceptance Criteria

- [x] A user can start a session from Studio and never manually copy prompts unless they choose manual mode.
- [x] The session asks for detailed issue information before planning.
- [x] The accepted details are saved as `issue_details.md`.
- [x] CRUD details are captured before planning when relevant.
- [x] Issue category and UI impact are saved and visible.
- [x] The plan reads issue details, blueprint, helper map, and decisions.
- [x] The approved plan is commented on the GitHub issue.
- [x] Agent decisions are appended throughout the workflow.
- [x] Deep UI Check runs for UI-impacting issues and skips cleanly for server-only issues.
- [x] Automated checks run before and after review/deslop.
- [x] Failed checks are repairable without arbitrary state jumping.
- [x] Failed user check can start a new Plan fine tuning cycle without deleting prior receipts.
- [x] No arbitrary step jumping is available.
- [x] The blueprint is updated before final verification and PR creation.
- [x] Final report is created and commented on the GitHub issue.
- [x] GitHub issue comments are idempotent on rerun.
- [x] Helper map still updates inside PR creation.
- [x] Mutating repair/review/UI steps cannot leave unowned dirty changes before advancing.
- [x] Studio renders all new state from JSKIT JSON.
- [x] Completed sessions archive all important artifacts.
- [x] Old long AGENTS/workboard workflow does not come back.
