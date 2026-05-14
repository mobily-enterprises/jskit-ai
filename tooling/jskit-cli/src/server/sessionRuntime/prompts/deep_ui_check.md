Deep UI quality check for JSKIT session {{session_id}}.

Phase: {{phase}}
GitHub issue: {{issue_url}}
Issue number: {{issue_number}}
Issue title: {{issue_title}}
Issue body file: {{issue_file}}
Issue details file (`issue_details.md`): {{issue_details_file}}
Plan file: {{plan_file}}
UI impact: {{ui_impact}}
Worktree: {{worktree}}

Changed files since the session base:

{{changed_files}}

Run a focused UI quality pass for the current worktree. If this is not UI-impacting after inspection, say exactly why and do not edit files. If the issue touches UI, inspect the changed routes, views, components, placements, layouts, and styles.

Check:

- Material Design quality.
- Vuetify best practices.
- visual hierarchy and density.
- spacing and alignment.
- responsive behavior on mobile, tablet, and desktop.
- loading, empty, error, disabled, and success states where relevant.
- accessibility basics.
- route and navigation coherence.
- consistency with the existing app style.

When clear scoped UI issues exist, fix them in the worktree. Keep fixes limited to the issue, confirmed issue details, and approved plan.

Use Playwright for a meaningful route check when possible. If login is required, use a development-only auth bootstrap path. When possible, record UI verification with:

`npx --no-install jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>`

Do not create commits, branches, issues, pull requests, merges, or worktree cleanup. JSKIT session owns those steps.

If this pass makes UI fixes, intentionally skips UI work after inspection, changes a design direction, or leaves a meaningful UI verification gap, include concise decision entries with reasons in this exact marker block:

```text
[agent_decisions]
<Deep UI decisions or "No new decisions.">
[/agent_decisions]
```

At the very end, include this completion block so Studio knows the step is complete:

[jskit_step_result]
status: complete
step: deep_ui_check_run
summary: Short summary of UI findings, fixes, verification, or why no UI work applied.
[/jskit_step_result]
