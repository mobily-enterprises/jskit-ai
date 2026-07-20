# Row Policies

Use when:

- mandatory record visibility needs `OR`, `EXISTS`, joins, memberships, or hierarchy traversal
- filtering after pagination produces empty or incomplete pages
- another package grants access to a resource but a reverse dependency would create a cycle
- the user mentions `RowPolicyPlugin`, recursive CTEs, descendants, or permission-filtered counts

Read first:

- `packages/agent-docs/site/guide/generators/row-policies.md`
- the owning CRUD provider and shared resource
- the generated CRUD repository and service templates
- `packages/crud-server-generator/test/crudService.test.js`

Default JSKIT pattern:

1. Keep public search and structured filters in the existing list-filter contract.
2. Keep direct user/workspace ownership and write stamping in autofilter.
3. Put complex mandatory read visibility in a server-only row policy.
4. Pass the policy through `createJsonRestResourceScopeOptions(resource, { rowPolicy })` in the owning provider.
5. Derive identity from trusted execution context.
6. Group every policy-owned `OR` branch.
7. Return `true` after adding the predicate, return `false` to deny all rows, or throw for invalid trusted context.
8. Keep action permissions for writes; visibility is not mutation authorization.

Package composition:

- the package that owns the resource also owns the row policy
- a package that grants extra visibility depends on the resource owner
- the resource owner does not import grant packages
- create one application-scoped visibility object during the owner's `register()`
- grant packages add contributions during their `register()`
- the owner seals the contributions and builds the policy during `boot()`
- do not use module-global mutable registries

Child-resource rules:

- a self-referencing relationship targets the same resource and receives the same row policy
- a separate child resource needs its own policy when it has an independent visibility rule
- never repair includes or child lists with response filtering

Testing:

- interleave visible and hidden rows so paginate-then-filter cannot accidentally pass
- assert first page, later page, total count, and cursor behavior
- assert missing identity fails closed
- assert hidden direct records behave as not found
- assert children and includes do not leak records
- assert package and provider dependencies stay one-way

AnyAPI boundary:

- the current JSKIT internal JSON REST host uses normal Knex tables
- do not add speculative backend detection or fallback code
- add an explicit AnyAPI host and domain regression before claiming JSKIT AnyAPI support for a policy

Avoid:

- filtering `document.data` in `service.js`
- accepting visible ids or hierarchy roots from client query parameters
- installing `RowPolicyPlugin` in generated applications
- adding a default policy file to every generated CRUD
- returning a Knex builder or promise from a synchronous grouped contribution
- swallowing a policy error and retrying without mandatory visibility
