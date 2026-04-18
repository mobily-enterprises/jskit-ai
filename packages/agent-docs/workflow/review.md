# Review Workflow

Before calling a feature done, review it in three passes:

1. Implementation gap review
   - missing states
   - broken flows
   - incomplete ownership handling
   - missing migrations or route wiring
2. JSKIT review
   - existing helper/runtime seam available?
   - duplicate local code that should reuse kernel/runtime support?
   - package metadata and actual behavior still aligned?
3. Verification review
   - run the smallest relevant verification commands
   - note anything left unverified

Minimum expectation:

- list the files changed
- list the commands run
- list anything still unverified
