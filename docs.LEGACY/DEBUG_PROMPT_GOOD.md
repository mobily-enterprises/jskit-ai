
    

    SAFETY — Worktree + Branch Isolation (HARD RULES)
    - You MUST start on `main` in the main worktree.
    - You MUST keep all file-rename state changes uncommitted on `main`.
    - You MUST do all code edits and commits inside a dedicated worktree directory.
    - You MAY create or move your task branch only: `slop/<bucket>-<id>`.
    - You MUST NOT commit any rename of `CODE_FINDINGS/<bucket>/` files.

    HARD RULE: Do NOT stop for prompt if you notice extra files in git, since that
    is normal. If those files weren't relevant to you, keep working

    You are assigned to work ONLY in this bucket:
    - BUCKET = THE ONE ASSIGNED TO YOU

    FINDINGS QUEUE (TRACKED IN GIT):
    - Work items: `CODE_FINDINGS/<bucket>/<id>.md`
    - Ignore `QUESTION.md`
    - State is tracked via renames using `mv` on `main` only:
      - available: `<id>.md`
      - in-progress: `<id>.md.locked`
      - complete: `<id>.md.done.<commit>` / `<id>.md.wont` / `<id>.md.mergeFail`

    You must continue with findings  from BUCKET until an unrecoverable error happens, in which case stop.
    If no available findings exist, stop and report.

    PHASE 0 — Start On Main + Decide
    1. Ensure you are on `main` in the primary worktree.
    2. Decide what finding to work on (smallest numeric `<id>.md` available).

    PHASE 1 — Claim On Main (Uncommitted)
    3. Claim the finding by renaming it on `main`:
       - `mv CODE_FINDINGS/<bucket>/<id>.md CODE_FINDINGS/<bucket>/<id>.md.locked`
    4. Do NOT commit this rename. Leave it uncommitted on `main`.

    PHASE 2 — Create Worktree + Fix
    5. Create a dedicated worktree from `main`:
       - Branch name: `slop/<bucket>-<id>`
    6. Work ONLY inside that worktree for code changes.
    7. Open `CODE_FINDINGS/<bucket>/<id>.md.locked` and restate the finding in your own words.
    8. Verify the bug exists using concrete evidence. Cite file path + line numbers, or a failing test. If not reproducible,
    choose WONT (below) with justification.
    9. Implement a complete, high‑quality fix that addresses the root cause.
    10. Run ALL required tests and architecture checks:
        - `npm -ws --if-present test`
        - `npm run test:framework`
        - `npm run test:architecture:client`
        - `npm run test:architecture:shared-ui`
        - `npm run test:architecture:db`

    PHASE 3 — Commit Fix (No Rename In Commit)
    11. Commit ONLY code changes in the worktree. Do NOT include any `CODE_FINDINGS` rename.
    12. Commit message MUST include full report + fix comment:
        Title: `slop(<bucket>-<id>): <short description>`
        Body:
        ---
        Finding report (verbatim):
        <paste full original finding file contents here>

        How it was fixed:
        - <what changed>
        - <why it removes drift/slop>
        - <tests run: ...>
        ---

    PHASE 4 — Merge To Main/Master (No Rename)
    13. Merge the fix from the worktree branch into `master` (or `main`) WITHOUT the file rename.
    14. Do not commit or merge any `CODE_FINDINGS` rename as part of the fix.

    PHASE 5 — Return To Main + Finalize Rename (Uncommitted)
    15. Switch back to the primary worktree on `main`.
    16. Keep the original `.locked` rename uncommitted and rename it to the final state:
        - DONE path:
          `mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.done.<commit>`
          Append summary + tests + final commit hash.
        - WONT path:
          `mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.wont`
          Append justification + what signal would make it worth fixing later.
        - MERGE FAIL path:
          `mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.mergeFail`
          Append a COMPLETE attempted-changes report:
          1. Branch name used
          2. Full list of files changed
          3. For each file: short description of changes
          4. Commands run + outputs/errors
          5. Exact reason merge failed
          6. Next steps for another agent

    17. Do NOT commit these renames. Leave them uncommitted on `main`.
    18. Stop after exactly one finding.

    If you want me to keep parts of the old safety rules (like “never merge onto main locally”), say so and I’ll fold them
    back in without breaking your new flow.


  › This is great but you completely wiped out my actual coding instructions which arguably are the most important thing
    here...      11. Implement a complete, high‑quality fix that addresses the root cause, not just symptoms.
                  Use production‑grade engineering standards: clear design, correct edge cases, safe refactors, minimal
    risk.
                  Follow existing project patterns, architecture, and style.
                  Prefer the smallest change that fully solves the problem, but never at the expense of correctness or
    robustness.
                  If tradeoffs exist, choose the option with the best long‑term maintainability and correctness.

    Redo with my instructions


  • Got it. Here’s the same revised prompt with your original fix-quality instructions preserved verbatim.

    You are assigned bucket CODE_FINDINGS/12_SLOP

    SAFETY — Worktree + Branch Isolation (HARD RULES)
    - You MUST start on `main` in the main worktree.
    - You MUST keep all file-rename state changes uncommitted on `main`.
    - You MUST do all code edits and commits inside a dedicated worktree directory.
    - You MAY create or move your task branch only: `slop/<bucket>-<id>`.
    - You MUST NOT commit any rename of `CODE_FINDINGS/<bucket>/` files.

    You are assigned to work ONLY in this bucket:
    - BUCKET = THE ONE ASSIGNED TO YOU

    FINDINGS QUEUE (TRACKED IN GIT):
    - Work items: `CODE_FINDINGS/<bucket>/<id>.md`
    - Ignore `QUESTION.md`
    - State is tracked via renames using `git mv` on `main` only:
      - available: `<id>.md`
      - in-progress: `<id>.md.locked`
      - complete: `<id>.md.done.<commit>` / `<id>.md.wont` / `<id>.md.mergeFail`

    You must complete EXACTLY ONE finding from BUCKET and then stop.
    If no available findings exist, stop and report.

    PHASE 0 — Start On Main + Decide
    1. Ensure you are on `main` in the primary worktree.
    2. Decide what finding to work on (smallest numeric `<id>.md` available).

    PHASE 1 — Claim On Main (Uncommitted)
    3. Claim the finding by renaming it on `main`:
       - `git mv CODE_FINDINGS/<bucket>/<id>.md CODE_FINDINGS/<bucket>/<id>.md.locked`
    4. Do NOT commit this rename. Leave it uncommitted on `main`.

    PHASE 2 — Create Worktree + Fix
    5. Create a dedicated worktree from `main`:
       - Branch name: `slop/<bucket>-<id>`
    6. Work ONLY inside that worktree for code changes.
    7. Open `CODE_FINDINGS/<bucket>/<id>.md.locked` and restate the finding in your own words.
    8. Verify the bug exists using concrete evidence. Cite file path + line numbers, or a failing test. If not reproducible,
    choose WONT (below) with justification.
    9. Implement a complete, high‑quality fix that addresses the root cause, not just symptoms.
       Use production‑grade engineering standards: clear design, correct edge cases, safe refactors, minimal risk.
       Follow existing project patterns, architecture, and style.
       Prefer the smallest change that fully solves the problem, but never at the expense of correctness or robustness.
       If tradeoffs exist, choose the option with the best long‑term maintainability and correctness.
    10. Run ALL required tests and architecture checks:
        - `npm -ws --if-present test`
        - `npm run test:framework`
        - `npm run test:architecture:client`
        - `npm run test:architecture:shared-ui`
        - `npm run test:architecture:db`

    PHASE 3 — Commit Fix (No Rename In Commit)
    11. Commit ONLY code changes in the worktree. Do NOT include any `CODE_FINDINGS` rename.
    12. Commit message MUST include full report + fix comment:
        Title: `slop(<bucket>-<id>): <short description>`
        Body:
        ---
        Finding report (verbatim):
        <paste full original finding file contents here>

        How it was fixed:
        - <what changed>
        - <why it removes drift/slop>
        - <tests run: ...>
        ---

    PHASE 4 — Merge To Main/Master (No Rename)
    13. Merge the fix from the worktree branch into `master` (or `main`) WITHOUT the file rename.
    14. Do not commit or merge any `CODE_FINDINGS` rename as part of the fix.

    PHASE 5 — Return To Main + Finalize Rename (Uncommitted)
    15. Switch back to the primary worktree on `main`.
    16. Keep the original `.locked` rename uncommitted and rename it to the final state:
        - DONE path:
          `git mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.done.<commit>`
          Append summary + tests + final commit hash.
        - WONT path:
          `git mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.wont`
          Append justification + what signal would make it worth fixing later.
        - MERGE FAIL path:
          `git mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.mergeFail`
          Append a COMPLETE attempted-changes report:
          1. Branch name used
          2. Full list of files changed
          3. For each file: short description of changes
          4. Commands run + outputs/errors
          5. Exact reason merge failed
          6. Next steps for another agent

    17. Do NOT commit these renames. Leave them uncommitted on `main`.
    18. Go back to 1, start again

    If you want me to reinsert any other portions of the original prompt (like rebase rules or lock-push behavior), tell me
    which parts to preserve and I’ll blend them back in without breaking this flow.
