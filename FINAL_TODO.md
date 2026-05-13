# FINAL TODO: JSKIT Session Workflow Hardening

This file is the implementation checklist for the next major JSKIT session workflow revision. Tick items as they are completed. Do not treat this as a loose workboard for an app session; this is the product-level implementation plan for JSKIT itself.

## Ground Rules

- [x] Create this `FINAL_TODO.md` as the shared implementation checklist.
- [ ] Keep JSKIT as the source of truth for workflow state, steps, prompts, receipts, and session files.
- [ ] Keep Studio thin: Studio renders JSKIT session JSON and does not own a parallel workflow state machine.
- [ ] Do not resurrect the old giant `AGENTS.md` workflow.
- [ ] Move useful old workflow discipline into JSKIT-owned session steps, prompt templates, preconditions, receipts, and JSON.
- [ ] Keep all new session state filesystem-backed and inspectable under `.jskit/sessions/active/<session_id>/`.
- [ ] Keep generated durable app memory under `.jskit/`, not in old free-form workboard files.
- [ ] Add tests for every new session transition and every new JSON contract field.

## Explicit Non-Goals

- [ ] Do not make issue sessions reason about `empty`, `non_jskit_repo`, or `partial_jskit_app` as normal states.
- [ ] Do not make Codex recover arbitrary non-JSKIT directories inside the issue workflow.
- [ ] If a session is somehow started before app setup/app bootup readiness, JSKIT should block with a setup-required error rather than asking Codex to reason about recovery.
- [ ] Do not add a project picker, app registry, or multi-project behavior.
- [ ] Do not add a Studio-owned session workflow.
- [ ] Do not reintroduce `.jskit/WORKBOARD.md`.
- [ ] Do not make `AGENTS.md` long again.

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

- [ ] Session created.
- [ ] Worktree created.
- [ ] Dependencies installed.
- [ ] Initial issue prompt rendered.
- [ ] Issue drafted.
- [ ] GitHub issue created.
- [ ] Get issue details prompt rendered.
- [ ] Plan details gathered.
- [ ] Plan made.
- [ ] Plan fine tuning.
- [ ] Implementation changes accepted.
- [ ] Implementation changes committed.
- [ ] Pre-review checks run.
- [ ] Deep UI check run or skipped.
- [ ] Deslop/JSKIT review run.
- [ ] Review changes accepted.
- [ ] Review changes committed.
- [ ] Post-review checks run.
- [ ] Deep UI re-check run or skipped.
- [ ] User check completed.
- [ ] Blueprint updated.
- [ ] Final verification run.
- [ ] Final report created and commented.
- [ ] Branch pushed and PR created.
- [ ] PR merged, base updated, worktree removed.
- [ ] Session finished and archived.

## New And Revised Session Artifacts

- [ ] Add `.jskit/sessions/active/<session_id>/plan_details.md`.
- [ ] Add `.jskit/sessions/active/<session_id>/issue_metadata.json`.
- [ ] Add `.jskit/sessions/active/<session_id>/agent_decisions.md`.
- [ ] Add `.jskit/sessions/active/<session_id>/final_report.md`.
- [ ] Add `.jskit/sessions/active/<session_id>/github_comments.json` for idempotent GitHub issue comments.
- [ ] Add `.jskit/sessions/active/<session_id>/command_log.jsonl` if ordinary command execution needs durable command/output history beyond receipts.
- [ ] Add `.jskit/sessions/active/<session_id>/checks/` for structured check receipts.
- [ ] Add `.jskit/sessions/active/<session_id>/ui_checks/` for structured UI review/check receipts.
- [ ] Add `.jskit/sessions/active/<session_id>/review_passes/` for repeated deslop/JSKIT review passes.
- [ ] Keep `.jskit/APP_BLUEPRINT.md` as durable app memory.
- [ ] Keep `.jskit/helper-map.md` as generated helper/export memory.
- [ ] Make every artifact path appear in `jskit session <id> --json` when it exists.

## Naming Decision: Plan Details

- [ ] Use `plan_details.md` as the canonical accepted details file.
- [ ] Treat `Get issue details` as the human-facing step label, because the developer is clarifying the issue with Codex.
- [ ] Do not create a separate long-lived `issue_details.md` unless a compatibility alias is explicitly needed later.
- [ ] The execution prompt must tell Codex to follow both `plan.md` and `plan_details.md`.
- [ ] Any GitHub issue comment for the details step should post the accepted contents of `plan_details.md`.

## JSON Contract Additions

- [ ] Add `appReady` or equivalent setup-readiness status if JSKIT session must block before issue work.
- [ ] Add `planDetails` as a string.
- [ ] Add `planDetailsPath` as a string.
- [ ] Add `issueCategory` with allowed values: `client`, `server`, `client_server`, `tooling`, `unknown`.
- [ ] Add `uiImpact` with allowed values: `none`, `possible`, `definite`, `unknown`.
- [ ] Add `agentDecisionsPath`.
- [ ] Add `agentDecisionsSummary` or `agentDecisionsLatest`.
- [ ] Add `blueprintPath`.
- [ ] Add `blueprintExists`.
- [ ] Add `helperMapPath`.
- [ ] Add `helperMapExists`.
- [ ] Add `finalReportPath`.
- [ ] Add `finalReportText`.
- [ ] Add `githubComments[]` or comment receipt metadata so Studio can show which issue comments have been posted.
- [ ] Add `checks[]` with stable objects for automated checks.
- [ ] Add `uiChecks[]` with stable objects for UI/deep UI checks.
- [ ] Add `reviewPasses[]` with pass number, status, commit, changed files, and prompt path.
- [ ] Add `currentStepAction.conditional` for steps that can skip.
- [ ] Add `currentStepAction.skipReason` when JSKIT can determine why a conditional step is skipped.
- [ ] Add `currentStepAction.retryable` for blocked check/review/UI steps that should rerun after repair.
- [ ] Ensure `--json` writes only JSON to stdout.
- [ ] Contract-test all new fields on active, completed, abandoned, and blocked sessions.

## Step: Initial Issue Prompt

Goal: create a first implementation-ready issue draft from the user's short request, without mutating the project.

- [ ] Update `new_issue.md` to assume app setup already passed.
- [ ] Remove normal reasoning around `empty`, `non_jskit_repo`, and `partial_jskit_app`.
- [ ] Add instruction: if the filesystem contradicts a valid JSKIT app, report setup failure instead of inventing recovery work.
- [ ] Instruct the agent to read `.jskit/APP_BLUEPRINT.md` when present.
- [ ] Instruct the agent to read `.jskit/helper-map.md` when present.
- [ ] Instruct the agent to inspect `package.json`, `.jskit/lock.json`, `config/public.js`, relevant `src/`, and relevant `packages/`.
- [ ] Mention safe read-only commands: `pwd`, `ls`, `find`, `rg`, `cat`, `sed`, `git status`.
- [ ] Mention safe JSKIT inspection commands only when available and non-mutating:
  - [ ] `jskit list`
  - [ ] `jskit show <package> --details`
  - [ ] `jskit list-placements`
- [ ] Keep mutation commands forbidden in issue drafting:
  - [ ] no `jskit session step`
  - [ ] no `gh`
  - [ ] no `git add`
  - [ ] no `git commit`
  - [ ] no `git push`
  - [ ] no `npm install`
  - [ ] no generators
  - [ ] no tests
  - [ ] no doctor
- [ ] Keep output tags:
  - [ ] `[issue_title]...[/issue_title]`
  - [ ] `[issue_text]...[/issue_text]`
- [ ] Test that issue drafting remains read-only by prompt contract.
- [ ] Test that generated issue prompt mentions blueprint/helper-map/app inspection.

## New Step: Get Issue Details

Goal: let the developer and Codex talk until no important implementation details are missing, before planning begins.

### Step Shape

- [ ] Add JSKIT session steps after `issue_created` and before `plan_made`.
- [ ] Add internal step `plan_details_prompt_rendered`.
- [ ] Use visible label `Get issue details` for `plan_details_prompt_rendered`.
- [ ] Use button label `Start details conversation` for `plan_details_prompt_rendered`.
- [ ] Add internal step `plan_details_gathered`.
- [ ] Use visible label `Plan details gathered` for `plan_details_gathered`.
- [ ] Use button label `Save plan details` for `plan_details_gathered`.
- [ ] Keep both steps visible in CLI JSON; Studio may visually keep the form/conversation within the same details section using JSKIT-provided metadata, not hard-coded step IDs.
- [ ] Preserve a clean manual CLI flow.
- [ ] Preserve Studio's 1:1 rendering of JSKIT-owned steps.
- [ ] Add prompt artifact path: `prompts/plan_details.md`.
- [ ] Add accepted details file: `plan_details.md`.
- [ ] Add metadata file: `issue_metadata.json`.
- [ ] Append important decisions to `agent_decisions.md`.
- [ ] Comment accepted plan details on the GitHub issue.

### Prompt Behavior

- [ ] Create `tooling/jskit-cli/src/server/sessionRuntime/prompts/plan_details.md`.
- [ ] The prompt must tell Codex: "No stones unturned."
- [ ] Codex must read:
  - [ ] GitHub issue URL and issue text.
  - [ ] `.jskit/APP_BLUEPRINT.md`.
  - [ ] `.jskit/helper-map.md`.
  - [ ] `package.json`.
  - [ ] `.jskit/lock.json`.
  - [ ] `config/public.js`.
  - [ ] relevant `src/` and `packages/`.
  - [ ] relevant JSKIT package docs or `jskit show ... --details`.
- [ ] Codex must ask follow-up questions until implementation details are complete.
- [ ] Codex must ask for final confirmation before emitting final details.
- [ ] Codex must not edit files during this step.
- [ ] Codex must not run mutation commands during this step.

### Required Detail Areas

- [ ] If CRUD or persisted data is involved, require:
  - [ ] entity/table name.
  - [ ] field names.
  - [ ] field types.
  - [ ] required/optional/nullability.
  - [ ] defaults.
  - [ ] uniqueness.
  - [ ] indexes where relevant.
  - [ ] relationships.
  - [ ] ownership: `public`, `user`, `workspace`, `workspace_user`, or explicit exception.
  - [ ] allowed operations: `list`, `view`, `new`, `edit`, `delete`, or narrower set.
  - [ ] list fields.
  - [ ] view form shape.
  - [ ] edit/new form shape.
  - [ ] validation rules.
  - [ ] permissions and role boundaries.
  - [ ] migration/generator lane.
  - [ ] exact CRUD generator command or exact reason no CRUD generator applies.
- [ ] If UI is involved, require:
  - [ ] route path.
  - [ ] placement/surface target.
  - [ ] navigation entry expectations.
  - [ ] responsive layout expectations.
  - [ ] loading state.
  - [ ] empty state.
  - [ ] error state.
  - [ ] disabled state.
  - [ ] success state.
  - [ ] Material/Vuetify quality expectations.
  - [ ] Playwright verification path.
  - [ ] auth/bootstrap strategy if login is needed.
- [ ] If server-only work is involved, require:
  - [ ] endpoint/command/job shape.
  - [ ] request and response shape.
  - [ ] validation behavior.
  - [ ] auth/permission behavior.
  - [ ] persistence ownership if any.
  - [ ] error behavior.
  - [ ] verification path.
- [ ] If package/generator work is involved, require:
  - [ ] exact `jskit add` or `jskit generate` command.
  - [ ] reason the package/generator applies.
  - [ ] expected generated files.
  - [ ] follow-up custom code areas.
- [ ] If the request is intentionally tiny, still require:
  - [ ] exact file/path behavior.
  - [ ] acceptance criteria.
  - [ ] whether UI is impacted.
  - [ ] whether tests/checks are needed.

### Required Output Tags

- [ ] Require Codex to output:

```text
[issue_category]
client | server | client_server | tooling
[/issue_category]

[ui_impact]
none | possible | definite
[/ui_impact]

[plan_details]
<confirmed implementation details in Markdown>
[/plan_details]

[agent_decisions]
<append-only decision entries with reasons>
[/agent_decisions]
```

- [ ] Add parser helpers for these tags.
- [ ] Validate allowed `issue_category` values.
- [ ] Validate allowed `ui_impact` values.
- [ ] Reject empty `plan_details`.
- [ ] Save `agent_decisions` by appending to session `agent_decisions.md`.
- [ ] Write a receipt when details are saved.
- [ ] Add tests for valid output.
- [ ] Add tests for missing tags.
- [ ] Add tests for invalid category.
- [ ] Add tests for invalid UI impact.
- [ ] Add tests that plan details are commented on the GitHub issue.

## Issue Classification

- [ ] Store classification in `issue_metadata.json`.
- [ ] Include `issueCategory` in session JSON.
- [ ] Include `uiImpact` in session JSON.
- [ ] Use `uiImpact` to decide whether Deep UI Check steps should run or skip.
- [ ] Treat `uiImpact=none` as skip for Deep UI Check.
- [ ] Treat `uiImpact=possible` as run unless the user explicitly marks UI not impacted.
- [ ] Treat `uiImpact=definite` as mandatory Deep UI Check.
- [ ] Add an explicit skip/override path for `uiImpact=possible`, requiring a short reason that is stored in `ui_checks/`.
- [ ] Add repair/error behavior when classification is missing before UI/check steps.
- [ ] Add Studio display for category and UI impact in the session info cards.

## GitHub Comment Idempotency

Goal: rerunning a step must not spam the GitHub issue with duplicate plan/details/final-report comments.

- [ ] Store comment metadata in `github_comments.json`.
- [ ] Track comment purpose keys such as `plan_details`, `plan`, `agent_decisions`, and `final_report`.
- [ ] Store comment URL or id when `gh` exposes it.
- [ ] If a comment already exists for a purpose, update it when supported or skip with a clear receipt.
- [ ] If update is not feasible in V1, skip duplicate comments after the first successful comment and report the stored comment URL/id.
- [ ] Add tests that rerunning plan-details comment does not duplicate the issue comment.
- [ ] Add tests that rerunning plan comment does not duplicate the issue comment.
- [ ] Add tests that rerunning final-report comment does not duplicate the issue comment.

## Agent Decisions Log

Goal: preserve the why behind important choices without resurrecting a workboard.

- [ ] Add session-owned `agent_decisions.md`.
- [ ] Initialize it with session id, issue URL, and timestamp.
- [ ] Append decisions from Get Issue Details.
- [ ] Append generator/package decisions from Plan Made.
- [ ] Append implementation deviations from Plan Fine Tuning.
- [ ] Append Deep UI Check decisions.
- [ ] Append verification decisions.
- [ ] Append blueprint-update decisions.
- [ ] Keep entries concise and reasoned.
- [ ] Do not use this as task tracking.
- [ ] Do not make it app-global.
- [ ] Include latest decision summary in `jskit session <id> --json`.
- [ ] Comment the decision log or a summarized decision report on the GitHub issue near the end.
- [ ] Add tests that decisions are appended, not overwritten.
- [ ] Add tests that the final report links or includes decisions.

## Plan Made Step

Goal: produce an implementation plan only after the issue and details are complete.

- [ ] Update `plan_issue.md` to read `plan_details.md`.
- [ ] Update `plan_issue.md` to read `agent_decisions.md`.
- [ ] Update `plan_issue.md` to read `.jskit/APP_BLUEPRINT.md`.
- [ ] Update `plan_issue.md` to read `.jskit/helper-map.md`.
- [ ] Require plan to include the issue category and UI impact.
- [ ] Require plan to include exact generator/package decisions.
- [ ] Require plan to include exact JSKIT inspection commands used or to use.
- [ ] For CRUD work, require exact server CRUD command or exact reason not applicable.
- [ ] For non-CRUD UI pages, require exact UI generator command or exact reason not applicable.
- [ ] For UI-impacting work, require planned Playwright and Deep UI Check path.
- [ ] For auth-required UI, require local dev auth/bootstrap strategy.
- [ ] Require plan output tags:

```text
[plan]
<implementation plan>
[/plan]

[agent_decisions]
<new decisions from planning>
[/agent_decisions]
```

- [ ] Save `plan.md`.
- [ ] Append plan decisions to `agent_decisions.md`.
- [ ] Comment the approved plan on the GitHub issue immediately after approval.
- [ ] Ensure this existing behavior is explicit and tested.
- [ ] Add tests that `plan_made` requires `plan_details.md`.
- [ ] Add tests that plan comment includes the approved plan.

## Plan Fine Tuning Step

Goal: let the user refine the plan with Codex, then implement in the worktree.

- [ ] Update `fine_tune_plan.md` to read `plan_details.md`.
- [ ] Update `fine_tune_plan.md` to explicitly say Codex must follow both `plan.md` and `plan_details.md`.
- [ ] Update `fine_tune_plan.md` to read `agent_decisions.md`.
- [ ] Update prompt to preserve user refinements as decision-log entries.
- [ ] Require Codex to append any meaningful implementation deviations to `agent_decisions.md` through tagged output or a session step input.
- [ ] Keep Codex from creating commits, PRs, merges, or worktree cleanup.
- [ ] Keep Codex working only inside the session worktree.
- [ ] Add tests that prompt includes plan details path.
- [ ] Add tests that prompt includes decisions path.

## Mutation And Commit Model For Repair / Quality Steps

Goal: every Codex step that can edit files must leave the worktree in a known committed or explicitly accepted state before the workflow advances.

- [ ] Define which prompt steps are allowed to mutate files.
- [ ] Treat Plan Fine Tuning / implementation as mutating.
- [ ] Treat Deep UI Check as mutating when it fixes scoped UI issues.
- [ ] Treat Deslop/JSKIT review as mutating when it fixes findings.
- [ ] Treat check/doctor repair prompts as mutating when they fix failures.
- [ ] After any mutating Codex quality/repair step, require an accept/commit path before proceeding.
- [ ] Avoid leaving dirty worktree changes between quality/check steps unless the next step explicitly owns those dirty changes.
- [ ] Include dirty-worktree status in `jskit session <id> --json`.
- [ ] Add a generic commit helper for session-owned quality/repair commits where possible.
- [ ] Commit messages should identify the session and phase, for example `Deep UI check fixes for <session_id>`.
- [ ] Add tests that Deep UI Check changes are committed or explicitly skipped before deslop/review advances.
- [ ] Add tests that check-repair changes are committed before rerunning the check step.
- [ ] Add tests that repeated review pass changes are committed per pass.

## Repeated Deslop / JSKIT Review

Goal: support multiple deslop/JSKIT review passes without hard-coding three duplicated visible step groups.

- [ ] Design repeatable review pass storage under `review_passes/<n>/`.
- [ ] Keep the visible step model simple.
- [ ] Avoid reintroducing separate numbered visible steps such as `review_prompt_rendered_1`, `review_prompt_rendered_2`, etc.
- [ ] Add `reviewPasses[]` to JSON.
- [ ] Add current review pass number to JSON.
- [ ] Add maximum review pass setting with a conservative default.
- [ ] Add prompt support for "run another deslop/JSKIT review pass".
- [ ] Keep Deslop and JSKIT review as distinct sections in the prompt.
- [ ] Deslop checks:
  - [ ] duplicate helpers.
  - [ ] unnecessary helpers.
  - [ ] fake-complete UI.
  - [ ] missing states.
  - [ ] dead code.
  - [ ] weak route wiring.
  - [ ] placeholder copy/code.
- [ ] JSKIT checks:
  - [ ] wrong generator choice.
  - [ ] missed package/runtime seam.
  - [ ] hand-built CRUD where generated ownership is required.
  - [ ] direct knex outside approved lanes.
  - [ ] metadata drift.
  - [ ] surface/route/ownership mistakes.
- [ ] Add a way to stop review passes when no important findings remain.
- [ ] Add a way to request another pass when important findings remain.
- [ ] Ensure each review pass that changes files has an accept/commit path before the next pass.
- [ ] Ensure each review pass records the commit SHA or records that no changes were needed.
- [ ] Add tests for zero-change review pass.
- [ ] Add tests for review pass with changes.
- [ ] Add tests for max pass handling.

## Automated Checks Before And After Review

Goal: make checks a first-class session concept, not only an afterthought.

- [ ] Add step before review/deslop: `pre_review_checks_run`.
- [ ] Add step after review/deslop: `post_review_checks_run`.
- [ ] Decide button labels:
  - [ ] `Run checks`
  - [ ] `Run checks again`
- [ ] Run the smallest relevant automated checks for the current project.
- [ ] Prefer existing project script order:
  - [ ] `npm run verify:local` if present.
  - [ ] else `npm run verify` if present.
  - [ ] else `npx jskit app verify`.
  - [ ] else known fallback scripts if appropriate.
- [ ] Store stdout/stderr summaries under `checks/`.
- [ ] Store structured status in JSON.
- [ ] If pre-review checks fail, block and render repair prompt.
- [ ] If post-review checks fail, block and render repair prompt.
- [ ] If a repair prompt changes files, commit the repair before rerunning the same check.
- [ ] After repair, rerun the same check step rather than arbitrary jumping.
- [ ] Avoid generic arbitrary state-machine jumping in V1.
- [ ] Add tests for passing pre-review checks.
- [ ] Add tests for failing pre-review checks.
- [ ] Add tests for passing post-review checks.
- [ ] Add tests for failing post-review checks.
- [ ] Add tests that blocked check steps are retryable.

## Deep UI Check Before And After Review

Goal: add a focused UI quality pass for visual/client-impacting work.

- [ ] Add step before deslop/review: `deep_ui_check_run`.
- [ ] Add step after deslop/review: `deep_ui_recheck_run`.
- [ ] Use `uiImpact` to decide run/skip.
- [ ] If `uiImpact=none`, write a skipped receipt with reason.
- [ ] If `uiImpact=possible`, run unless explicitly overridden.
- [ ] If `uiImpact=definite`, require run.
- [ ] Create prompt `deep_ui_check.md`.
- [ ] The prompt must inspect changed UI files, routes, components, layouts, and screenshots if available.
- [ ] The prompt must check:
  - [ ] Material Design quality.
  - [ ] Vuetify best practices.
  - [ ] visual hierarchy.
  - [ ] spacing.
  - [ ] responsive behavior.
  - [ ] loading states.
  - [ ] empty states.
  - [ ] error states.
  - [ ] disabled states.
  - [ ] success states.
  - [ ] accessibility basics.
  - [ ] route/navigation coherence.
  - [ ] consistency with existing app style.
- [ ] The prompt must ask Codex to fix scoped UI issues when clear.
- [ ] The prompt must not create commits or PRs.
- [ ] If the Deep UI Check fixes files, require accept/commit before continuing.
- [ ] If the Deep UI Re-check fixes files, require accept/commit before continuing.
- [ ] Integrate Playwright guidance:
  - [ ] run a meaningful route check when possible.
  - [ ] use local dev auth bootstrap when needed.
  - [ ] record UI verification with `jskit app verify-ui`.
  - [ ] call out missing auth bootstrap as a testability gap.
- [ ] Store UI check output under `ui_checks/`.
- [ ] Include UI check status in JSON.
- [ ] Add tests for skipped server-only issue.
- [ ] Add tests for mandatory UI-impact issue.
- [ ] Add tests for failed UI check repair prompt.
- [ ] Add Studio rendering for skipped/running/passed/failed UI checks.

## User Check Step

Goal: keep human verification as a distinct step.

- [ ] Keep existing `user_check_completed` step.
- [ ] Update prompt to mention plan details and planned acceptance criteria.
- [ ] Tell user exactly what route, behavior, command, or workflow to inspect.
- [ ] If user reports failure, render repair prompt and keep session in a retryable state.
- [ ] If user reports pass, write receipt.
- [ ] Include user check result in final report.
- [ ] Add tests for failed user check path if not already covered.

## Blueprint Updated Step

Goal: enrich durable app memory issue by issue.

### Step Position

- [ ] Add `blueprint_updated` after user check and review/check cycles.
- [ ] Run it before final verification/doctor and before PR creation.
- [ ] Ensure blueprint changes are included in the session branch.
- [ ] Commit blueprint changes if changed.
- [ ] If blueprint is unchanged, write an unchanged receipt.

### Prompt Behavior

- [ ] Create prompt `update_blueprint.md`.
- [ ] Prompt reads:
  - [ ] current `.jskit/APP_BLUEPRINT.md` if present.
  - [ ] issue title/body.
  - [ ] plan details.
  - [ ] approved plan.
  - [ ] agent decisions.
  - [ ] changed files.
  - [ ] helper map.
  - [ ] package/app metadata.
- [ ] Prompt updates only durable app/product/architecture memory.
- [ ] Prompt must not include session task tracking.
- [ ] Prompt must not recreate `.jskit/WORKBOARD.md`.
- [ ] Prompt must not over-expand tiny issues into broad product rewrites.
- [ ] Prompt should naturally evolve from a minimal app sketch to a richer app blueprint over many issues.
- [ ] Prompt output tag:

```text
[app_blueprint]
<full updated blueprint markdown>
[/app_blueprint]
```

### Runtime Behavior

- [ ] Parse `[app_blueprint]`.
- [ ] Write `.jskit/APP_BLUEPRINT.md`.
- [ ] If changed, commit with a clear message.
- [ ] Append blueprint decision summary to `agent_decisions.md`.
- [ ] Add blueprint update receipt.
- [ ] Add blueprint status to JSON.
- [ ] Add tests for creating a new blueprint.
- [ ] Add tests for updating an existing blueprint.
- [ ] Add tests for unchanged blueprint.
- [ ] Add tests that blueprint update happens before final verification.
- [ ] Add CLI/session input support for accepting the tagged blueprint output, for example `--blueprint -` or a step-specific equivalent.
- [ ] Add tests for invalid/missing `[app_blueprint]` output.

## Final Verification / Doctor

Goal: verify the full branch after implementation, review, UI checks, and blueprint update.

- [ ] Keep existing final verification step.
- [ ] Ensure final verification runs after blueprint update.
- [ ] Ensure final verification sees all committed changes.
- [ ] Ensure UI receipt expectations are respected when UI files changed.
- [ ] Keep doctor failures repairable.
- [ ] Update doctor failure prompt to mention:
  - [ ] plan details.
  - [ ] blueprint update.
  - [ ] helper map.
  - [ ] UI checks.
  - [ ] check receipts.
- [ ] Add tests that final verification runs after blueprint update.
- [ ] Add tests that final verification failure blocks PR creation.

## Final Report Step

Goal: generate a clear final report for the issue before PR/merge completion.

- [ ] Add step `final_report_created`.
- [ ] Position it after final verification and before branch push / PR creation.
- [ ] Do not require the PR URL in this report; the later final comment can include PR URL after creation/merge.
- [ ] Generate the final report deterministically from session artifacts in V1.
- [ ] Do not make final report generation depend on another Codex prompt in V1.
- [ ] Report must include:
  - [ ] issue URL.
  - [ ] issue title.
  - [ ] plan details summary.
  - [ ] plan summary.
  - [ ] files changed.
  - [ ] commits.
  - [ ] commands/checks run.
  - [ ] UI checks run or skipped.
  - [ ] Playwright/verify-ui status.
  - [ ] user check result.
  - [ ] blueprint update status.
  - [ ] helper map update status.
  - [ ] remaining unverified gaps.
  - [ ] important decisions and why.
- [ ] Write `final_report.md`.
- [ ] Comment final report on the GitHub issue.
- [ ] Include final report path/text in JSON.
- [ ] Add tests that final report is created.
- [ ] Add tests that final report is commented on issue.
- [ ] Add tests that final report includes checks and UI checks.

## Branch Pushed And PR Created Step

Goal: keep PR creation as the single visible step that finalizes branch publication.

- [ ] Keep helper map update inside this step.
- [ ] Ensure helper map changes are committed before push.
- [ ] Ensure blueprint/final report changes have already been committed or intentionally recorded.
- [ ] Ensure branch push includes all final commits.
- [ ] Create PR with issue body and "Closes #".
- [ ] Preserve existing GitHub auth/remote preconditions.
- [ ] Keep behavior idempotent when PR already exists if possible.
- [ ] Add tests that helper map commit occurs before push.
- [ ] Add tests that final report/blueprint commits are present before push.

## PR Merged / Worktree Removed Step

Goal: merge safely, update local base, clean worktree, and preserve recoverability.

- [ ] Preserve current already-merged PR handling.
- [ ] Preserve current target-root dirty check.
- [ ] Preserve current base branch fast-forward checks.
- [ ] Preserve issue close/comment behavior.
- [ ] Preserve branch recoverability where possible.
- [ ] Preserve worktree cleanup.
- [ ] Ensure final session archive includes:
  - [ ] final report.
  - [ ] agent decisions.
  - [ ] plan details.
  - [ ] check receipts.
  - [ ] UI check receipts.
  - [ ] prompt artifacts.
- [ ] Add tests for archive contents.

## Studio Integration

Goal: update Studio only after JSKIT JSON supports the workflow.

- [ ] Do not hard-code new step IDs in Studio beyond generic rendering needs.
- [ ] Render `planDetails`.
- [ ] Render `issueCategory`.
- [ ] Render `uiImpact`.
- [ ] Render `agentDecisions` card/link.
- [ ] Render `finalReport` card/link.
- [ ] Render `checks[]`.
- [ ] Render `uiChecks[]`.
- [ ] Render `reviewPasses[]`.
- [ ] Support conditional skipped steps visually.
- [ ] Support retryable blocked steps visually.
- [ ] In `Get issue details`, render the Codex conversation and output form inside the step.
- [ ] In `Plan made`, include plan details context.
- [ ] In Deep UI Check steps, show run/skip status clearly.
- [ ] Ensure terminal remains below/alongside todo according to current Studio layout.
- [ ] Ensure mobile layout keeps Codex terminal usable and collapsible.
- [ ] Ensure abandoned/completed session views show final report and decisions.
- [ ] Add tests or browser checks for the new Studio rendering.

## Prompt Inventory

- [ ] Update `new_issue.md`.
- [ ] Add `plan_details.md`.
- [ ] Update `plan_issue.md`.
- [ ] Update `fine_tune_plan.md`.
- [ ] Add or update `deep_ui_check.md`.
- [ ] Update `review_changes.md`.
- [ ] Update `user_check.md`.
- [ ] Add `update_blueprint.md`.
- [ ] Update `doctor_failure.md`.
- [ ] Update `pr_failure.md` if needed.
- [ ] Add a deterministic final report renderer; do not add a Codex prompt for final report in V1.
- [ ] Update `final_comment.md` if needed.
- [ ] Ensure all prompts mention the correct session-owned files.
- [ ] Ensure no prompt tells Codex to create `.jskit/WORKBOARD.md`.
- [ ] Ensure no prompt tells Codex to use old long `AGENTS.md` workflow.

## CLI And Parser Work

- [ ] Add input resolution for `--plan-details`, `--plan-details-file`, and `--plan-details -`.
- [ ] Add input resolution for `--issue-category`.
- [ ] Add input resolution for `--ui-impact`.
- [ ] Add input resolution for decision log fragments if needed.
- [ ] Add input resolution for blueprint update output, for example `--blueprint`, `--blueprint-file`, and `--blueprint -`.
- [ ] Add extraction helpers:
  - [ ] `extractIssueCategory`.
  - [ ] `extractUiImpact`.
  - [ ] `extractPlanDetails`.
  - [ ] `extractAgentDecisions`.
  - [ ] `extractAppBlueprint`.
- [ ] Add validators for enum values.
- [ ] Add stable error codes for invalid plan details output.
- [ ] Add stable error codes for missing classification.
- [ ] Add stable error codes for missing details.
- [ ] Add stable repair commands for each new blocked state.

## Preconditions

- [ ] Add `plan_details_exists`.
- [ ] Add `issue_metadata_exists`.
- [ ] Add `plan_text_exists` if not already present.
- [ ] Add separate preconditions for `pre_review_checks_passed` and `post_review_checks_passed` where needed.
- [ ] Add separate preconditions for `deep_ui_check_satisfied` and `deep_ui_recheck_satisfied` where needed.
- [ ] Add `blueprint_update_satisfied`.
- [ ] Add `final_report_exists`.
- [ ] Add named precondition tests for every new executable step.
- [ ] Ensure every step except `session_created` declares named preconditions.

## Receipts

- [ ] Add receipt for plan details prompt rendered.
- [ ] Add receipt for plan details saved.
- [ ] Add receipt for plan details commented on issue.
- [ ] Add receipt for plan commented on issue.
- [ ] Add receipt or metadata for idempotent GitHub comment skip/update.
- [ ] Add receipt for pre-review checks run.
- [ ] Add receipt for Deep UI Check run/skipped.
- [ ] Add receipt for review pass run.
- [ ] Add receipt for post-review checks run.
- [ ] Add receipt for Deep UI Re-check run/skipped.
- [ ] Add receipt for blueprint updated/unchanged.
- [ ] Add receipt for final report created.
- [ ] Add receipt for final report commented on issue.
- [ ] Add tests that receipts are readable and archive with session.

## Tests

- [ ] Add tests for new plan details tag extraction.
- [ ] Add tests for plan details CLI stdin handling.
- [ ] Add tests for plan details prompt rendering.
- [ ] Add tests for plan details GitHub comment.
- [ ] Add tests for issue classification JSON fields.
- [ ] Add tests for plan requiring plan details.
- [ ] Add tests for plan comment on GitHub issue.
- [ ] Add tests for agent decision append behavior.
- [ ] Add tests for repeated review pass bookkeeping.
- [ ] Add tests for pre-review checks.
- [ ] Add tests for post-review checks.
- [ ] Add tests for Deep UI Check run.
- [ ] Add tests for Deep UI Check skipped.
- [ ] Add tests for blueprint update.
- [ ] Add tests for final verification order.
- [ ] Add tests for final report generation.
- [ ] Add tests for final report GitHub comment.
- [ ] Add tests for PR creation including blueprint/helper-map/final-report commits.
- [ ] Add tests for completed archive contents.
- [ ] Add tests for idempotent GitHub comments.
- [ ] Add tests for dirty-worktree blocking between quality/check phases.
- [ ] Update generated docs/reference tests if command exports change.
- [ ] Run focused session tests.
- [ ] Run `npm run lint`.
- [ ] Run `npm run check:runtime-deps`.
- [ ] Run broader `npm run verify:local` when the implementation is ready.

## Documentation

- [ ] Update `revolution.md` or replace with a current implementation tracker if appropriate.
- [ ] Update CLI help for new session flags.
- [ ] Update generated command reference through `npm run agent-docs:build`.
- [ ] Update agent docs tests that assert old workflow files are not active.
- [ ] Keep `packages/agent-docs/templates/app/AGENTS.md` tiny.
- [ ] Document the new Get Issue Details / `plan_details.md` flow.
- [ ] Document `agent_decisions.md`.
- [ ] Document blueprint enrichment.
- [ ] Document conditional Deep UI Check behavior.

## Acceptance Criteria

- [ ] A user can start a session from Studio and never manually copy prompts unless they choose manual mode.
- [ ] The session asks for detailed issue information before planning.
- [ ] CRUD details are captured before planning when relevant.
- [ ] Issue category and UI impact are saved and visible.
- [ ] The plan reads plan details, blueprint, helper map, and decisions.
- [ ] The approved plan is commented on the GitHub issue.
- [ ] Agent decisions are appended throughout the workflow.
- [ ] Deep UI Check runs for UI-impacting issues and skips cleanly for server-only issues.
- [ ] Automated checks run before and after review/deslop.
- [ ] Failed checks are repairable without arbitrary state jumping.
- [ ] The blueprint is updated before final verification and PR creation.
- [ ] Final report is created and commented on the GitHub issue.
- [ ] Helper map still updates inside PR creation.
- [ ] Studio renders all new state from JSKIT JSON.
- [ ] Completed sessions archive all important artifacts.
- [ ] Old long AGENTS/workboard workflow does not come back.
