Create the canonical issue files from the scoped issue discussion in this Codex thread.

Canonical issue body file to write: {{issue_file}}
Canonical issue title file to write: {{issue_title_file}}

Use the issue definition and scoping conversation that just happened in this terminal. If something is still materially unclear, ask the user before writing the files.

Do not create a GitHub issue.
Do not implement the change.
Do not edit app code.
Do not run generators, tests, installs, `gh`, `git add`, `git commit`, `git push`, or JSKIT workflow mutation commands.

Write:

- A short issue title to `{{issue_title_file}}`.
- A concrete, implementation-ready issue body to `{{issue_file}}`.

The issue body should include:

- The requested change or bug clearly stated.
- The accepted scope.
- Important exclusions or non-goals.
- Relevant implementation boundaries.
- Acceptance criteria when useful.

After writing the files, show the title and body in the terminal for user review.
