DEBUG_PROMPT.md
You are one of multiple agents working in parallel on a codebase.

      You are assigned to work ONLY in this bucket:
      - BUCKET = `12_SLOP` (example: `04`, `07`, `12_SLOP`)

      FINDINGS QUEUE (TRACKED IN GIT):
      - Work items: `CODE_FINDINGS/<bucket>/<id>.md`
      - Ignore `QUESTION.md`
      - State is tracked via renames using `git mv`:
        - available: `<id>.md`
        - in-progress: `<id>.md.locked`
        - complete: `<id>.md.done.<commit>` / `<id>.md.wont` / `<id>.md.mergeFail`

      You must complete EXACTLY ONE finding from BUCKET and then stop.
      If no available findings exist, stop and report.

      PHASE 0 — Sync:
      1. `git fetch origin`
      2. Resolve default branch using `git remote show origin` or `git symbolic-ref refs/remotes/origin/HEAD`. Call it `MAIN`.
      3. Create a branch from latest main:
         - Branch name: `slop/<bucket>-<id>`
         - Start point: `origin/MAIN`
         - If `<id>` not known yet, use placeholder `slop/<bucket>-tmp`, then rename after locking.

      PHASE 1 — Pick + Claim (must happen BEFORE any code edits):
      4. In `CODE_FINDINGS/<bucket>/`, choose the smallest numeric `<id>.md` that is available.
         - Eligible: files ending exactly in `.md`
         - Ineligible: `QUESTION.md`
         - Ineligible: any file already ending with `.locked`, `.wont`, `.mergeFail`, or `.done.*`
      5. If on placeholder branch, rename it to `slop/<bucket>-<id>`.
      6. Claim the finding by renaming it with git:
         - `git mv CODE_FINDINGS/<bucket>/<id>.md CODE_FINDINGS/<bucket>/<id>.md.locked`
      7. Commit ONLY this rename immediately:
         - Commit title: `claim(<bucket>-<id>): lock finding`
      8. If you have push access, push the branch now so others see the lock.
         If you do not have push access, continue locally.

      If you rebase later and discover the finding has already progressed on main to `.done.*`, `.wont`, or `.mergeFail`, STOP and
      abandon this finding (do not fight it).

      PHASE 2 — Verify + Fix:
      9. Open `CODE_FINDINGS/<bucket>/<id>.md.locked` and restate the finding in your own words.
      10. Verify the bug exists using concrete evidence. Cite file path + line numbers, or a failing test. If not reproducible,
    choose
      WONT (below) with justification.
      11. Implement a complete, high‑quality fix that addresses the root cause, not just symptoms.
          Use production‑grade engineering standards: clear design, correct edge cases, safe refactors, minimal risk.
          Follow existing project patterns, architecture, and style.
          Prefer the smallest change that fully solves the problem, but never at the expense of correctness or robustness.
          If tradeoffs exist, choose the option with the best long‑term maintainability and correctness.
      12. Run ALL required tests and architecture checks:
          `npm -ws --if-present test`
          `npm run test:framework`
          `npm run test:architecture:client`
          `npm run test:architecture:shared-ui`
          `npm run test:architecture:db`

      PHASE 3 — Commit message MUST include full report + fix comment:
      13. Create a commit for the fix. The commit message MUST contain:
          - The FULL original finding report text verbatim (copy/paste the entire contents of the locked finding file exactly as it
    was
      at the start)
          - A short section “How it was fixed” (bullets)

      Suggested format:

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

      PHASE 4 — Rebase + Merge (STRICT):
      14. `git fetch origin`
      15. Rebase your branch onto `origin/MAIN`.
      16. If conflicts occur:
          - Resolve code conflicts normally.
          - If `CODE_FINDINGS/<bucket>/` conflicts occur, prefer the most progressed state:
            `.done.*` > `.mergeFail` > `.wont` > `.locked` > `.md`
          - Never downgrade state.
      17. Re-run relevant tests after rebase.
      18. Attempt to merge into main using the repo’s standard method.
          - If you lack permission to push/merge, treat as mergeFail.

      If merge fails in ANY way (conflicts you cannot resolve cleanly, tests failing, push rejected, CI policy, permissions,
    anything):
      - DO NOT MERGE.
      - Mark mergeFail:
        - `git mv CODE_FINDINGS/<bucket>/<id>.md.locked CODE_FINDINGS/<bucket>/<id>.md.mergeFail`
      - Append a COMPLETE attempted-changes report inside that file, including:
        1. Branch name used
        2. Full list of files changed
        3. For each file: short description of changes
        4. Commands run + outputs/errors
        5. Exact reason merge failed (copy error/conflict summary)
        6. Next steps for another agent
      - Commit that and stop.

      DONE path:
      19. If merge succeeded:
      - Rename:
        - `git mv .../<id>.md.locked .../<id>.md.done.<commit>`
      - Append summary + tests + final commit hash to the file.
      - Commit that and stop.

      WONT path:
      20. If you choose not to fix:
      - Rename:
        - `git mv .../<id>.md.locked .../<id>.md.wont`
      - Append justification + what signal would make it worth fixing later.
      - Commit that and stop.

      Additional rules:
      - Do not touch other buckets.
      - Do not edit `CODE_FINDINGS` except state transitions and required reports.
      - No unrelated refactors or formatting-only changes.

