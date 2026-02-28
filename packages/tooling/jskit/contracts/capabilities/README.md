# Capability Contracts

This directory is the central capability-contract registry for JSKIT.

- Canonical capability IDs and contract metadata live in [`index.mjs`](./index.mjs).
- The registry is the source of truth for `WHAT` a capability means.
- Package descriptors are the source of truth for `WHO` provides/requires capabilities.

Contract test convention:

- If a contract sets `requireContractTest: 1`, every provider package for that capability must include:
  - `test/contracts/<capabilityId>.contract.test.js`

Notes:

- Provider/consumer graphs are derived from descriptors at lint/doc time.
- `jskit lint-descriptors` validates:
  - every referenced capability has a central contract
  - central contracts are not stale/unused
  - required contract tests exist
  - required contract symbols are exported (when defined on the contract)
