# JSKIT Manual Future Notes

## Mini Tutorial Scope: Advanced Domain Policy Checks in Actions

This mini tutorial exists to document the advanced pattern that was intentionally removed from Chapter 3 Stage 8 to keep the main path beginner-friendly.

The core tutorial (Chapter 3) now teaches the baseline pattern:

- action calls `assertNoDomainRuleFailures(domainRulesService.buildRules(payload))`
- domain rules are synchronous and local
- controller stays success-path focused with `BaseController`

This mini tutorial will cover the advanced extension on top of that baseline.

### Why this is a separate mini tutorial

This pattern is useful, but it introduces extra moving parts:

- async policy lookup before rule evaluation
- policy context injection into `buildRules(...)`
- more DI wiring in provider
- more test setup (mocking policy sources)

That makes it a poor fit for the first-pass tutorial, but a good fit for an advanced follow-up.

### What this mini tutorial will teach, exactly

The mini tutorial will show the full flow below, end to end:

- prefetch policy context asynchronously in the action
- build rule definitions with payload + policy context
- enforce those rules through kernel helper assertion
- throw typed domain errors with consistent shape

Target pattern:

```js
const isAllowedEmailDomain = await this.domainRulesService.isAllowedEmailDomain(payload.email);
assertNoDomainRuleFailures(
  this.domainRulesService.buildRules(payload, {
    isAllowedEmailDomain
  })
);
```

### Concrete learning goals

After this mini tutorial, readers should be able to:

- decide when to stay with baseline synchronous rules vs when to add async policy checks
- implement a domain-rules service that supports both simple rules and context-aware rules
- keep controllers unchanged while action complexity grows
- keep transport validation (schema) separate from domain policy enforcement
- test async policy-dependent failures deterministically

### Files and layers the tutorial will include

The mini tutorial will include all of these layers explicitly:

- provider
  - adds and wires `domainRulesService` as a singleton
- action
  - performs async policy lookup and rule assertion before orchestration continues
- domain-rules service
  - exposes both `isAllowedEmailDomain(...)` and `buildRules(payload, context)`
- kernel helper usage
  - `assertNoDomainRuleFailures(...)` from `@jskit-ai/kernel/server/runtime`
- tests
  - success case, blocked-domain case, duplicate conflict case

### Step-by-step chapter outline

The mini tutorial will be written in progressive steps:

- baseline action recap
  - show Stage 8 baseline rule assertion
- add async policy lookup
  - introduce `isAllowedEmailDomain(...)` and explain why it is async
- inject policy context into rule building
  - evolve `buildRules(payload)` into `buildRules(payload, context)`
- wire provider DI
  - show provider delta that passes `domainRulesService` into affected actions
- verify error behavior
  - show thrown `DomainValidationError` payload shape and expected HTTP mapping
- add focused tests
  - isolate action behavior with mocked policy outcomes

### Non-goals for this mini tutorial

To avoid scope creep, this mini tutorial will not cover:

- full authentication/authorization strategy (belongs to auth chapter)
- generic policy DSL design across all modules
- persistence strategy redesign
- client-side policy mirroring

### Suggested placement in the manual

This mini tutorial should live under advanced server content, as one of:

- a section in `004-Kernel:_Server:_Advanced_Topics.md`
- or a focused appendix linked from Chapter 3 Stage 8

### Acceptance checklist for writing this mini tutorial

When authored, this mini tutorial is considered complete only if:

- it includes before/after snippets for provider + action + rules service
- it includes full final files (not snippets only)
- it includes one runnable example route
- it includes tests for both allowed and blocked domain outcomes
- it clearly states why this pattern is advanced and optional

