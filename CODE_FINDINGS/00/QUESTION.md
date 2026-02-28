  Goal:
    Find places where behavior is not fully derived from source-of-truth data/contracts, and instead depends on duplicated logic,
    hardcoded branches, or parallel heuristics that can diverge.

    Scope:
    - Entire repository (prioritize runtime/tooling/orchestration paths first)
    - Include code, tests, and docs assumptions

    What to flag (high priority):
    1. Hardcoded domain values in logic
       - IDs, capability names, provider names, bundle/package names, route names, flags
       - One-off special cases (`if x === "..."`) that encode business rules
    2. Duplicate rule systems
       - Same concept computed in multiple ways/locations
       - Separate “classification” and “validation” code paths that can disagree
    3. Data-model bypass
       - Behavior not derived from declared descriptors/schemas/contracts
       - Manual inference where canonical metadata already exists
    4. Hint/UX mismatch
       - UI/CLI output that omits or misrepresents actual enforced behavior
       - Informational output that can drift from real runtime constraints
    5. Validation vs execution mismatch
       - Checks enforced in one command/path but not others
       - Runtime failure modes not visible in preflight/listing/doctor-style checks
    6. Test fragility and masking
       - Tests asserting incidental output instead of contract
       - Missing tests for “single source of truth” invariants
    7. Contract drift risk
       - Docs, schemas, descriptors, and runtime behavior disagreeing
    8. Hidden transitive coupling
       - Components appearing independent but requiring undeclared implicit prerequisites

    Required output format:
    1. Findings first, ordered by severity (Critical, High, Medium, Low)
    2. For each finding:
       - File + line(s)
       - Pattern type (from list above)
       - Why it can drift/fail
       - Concrete impact (user-facing or operational)
       - Exact remediation (data-driven, single-source-of-truth approach)
    3. Cross-cutting drift map:
       - Concept -> all places it is computed/enforced/rendered
       - Mark where duplication exists
    4. Refactor plan:
       - Minimal sequence to collapse duplicate logic
       - Safe migration steps
       - Required regression tests
    5. Guardrails:
       - Lint/check/test ideas to prevent reintroduction

    Quality bar:
    - Evidence-based only; no vague claims
    - Prefer primary code references over assumptions
    - Call out uncertain items explicitly
    - If no issues in an area, state why

    Non-goals:
    - Style-only comments
    - Micro-optimizations without correctness impact

    Success criteria:
    - Every externally visible behavior is traceable to one canonical data contract
    - No business-critical branch logic depends on hardcoded literals
    - Listings/hints/validation/execution all agree on the same rule engine



