<!-- Generated from `packages/agent-docs/heuristics/row-policies.md`. -->

# Row Policies

Use when:

- mandatory record visibility needs `OR`, `EXISTS`, joins, memberships, or hierarchy traversal
- filtering after pagination produces empty or incomplete pages
- another package must narrow who sees a resource's rows but a reverse dependency would create a cycle
- the user mentions `RowPolicyPlugin`, recursive CTEs, descendants, or permission-filtered counts
- reads or writes of a resource with a policy get slower as records or a person's history grow

Read first:

- the owning feature's `owns` entry and the shared table resource
- the [data access](../data-access.md) guide's Layer 1
- `packages/resource-runtime/test/resourceRuntime.test.js` (policies, `ownTable`, contributions)

Default JSKIT pattern:

1. Keep public search and structured filters in the existing list-filter contract.
2. Keep direct user/workspace ownership and write stamping in the table resource's `ownership`.
3. Put complex mandatory read visibility in a server-only row policy.
4. Pass the policy in the owner's `owns` entry: `owns: [{ resource, rowPolicy }]`. It reads the owner's other tables through `ownTable(name)`, a read-only subquery, never by table name. Visibility rules live in the row policy, never in hand queries.
5. Derive identity from `caller` (`caller.kind`, then `caller.userId`), never from input. In a workspace request a role
   rule reads `context.permissions`, which the server resolves from the membership before any handle runs, with
   `hasPermission(context.permissions, "bookings.view-all")` from `@jskit-ai/kernel/shared/support`: `includes()`
   misses wildcard grants, such as an owner role's `*` or a `bookings.*`. List such a permission, which no action
   requires, in `roleCatalog.customPermissions`, or the server refuses to start outside production.
6. Group every policy-owned `OR` branch.
7. Return `true` after adding the predicate, return `false` to deny all rows, or throw for invalid trusted context.
8. Keep action permissions for writes; visibility is not mutation authorization.

Package composition:

- the feature that owns the resource also owns the row policy
- the owner accepts contributions with `{ resource, rowPolicy, acceptsContributions: true }` in `owns`
- a package that narrows visibility further depends on the resource owner and calls `resources.contributeRowPolicy(name, policy)` on the handles its own `owns` gave it; a contribution is ANDed with the owner's policy inside its own group, so it can only narrow
- a contribution never grants visibility: wider visibility (shared rows, grants another package records) is a rule in the owner's own policy over its own tables, and a contribution narrows every read of the table, every feature's included, so a rule for one surface is an owner API method instead
- the resource owner does not import contributing packages
- a policy that narrows through another owner's join source, when that owner requires the policy's own feature, declares the owner's capability `late` and reads `requires.<name>` at call time: the kernel resolves it once every feature has booted ([Late requirements](../data-access.md#late-requirements))
- a policy whose rule reads another owner's rows as stored, whether or not the reader may see them, reads them through that owner's API, which answers a join source under its own `systemScope` narrowed to the call's workspace; never through a context the policy builds
- do not use module-global mutable registries

Example, "your rooms or shared rooms":

```js
owns: [{
  resource: roomResource,
  acceptsContributions: true,
  rowPolicy({ query, caller, column, ownTable }) {
    if (caller.kind !== "user") return caller.kind !== "anonymous";
    query.where((rooms) => rooms
      .where(column("shared"), true)
      .orWhereIn(column("id"), ownTable("roomMembers").select("room_id").where("user_id", caller.userId)));
    return true;
  }
}]
```

A policy is told who the call runs for as `caller`: `user`, `anonymous`,
`system` or `job`. Background work is `system` or `job`, never a missing user,
and a job names its person only as `caller.actorId`. A policy hides a row from
every read, including other tables' links to it, so narrowing what one screen
lists is a filter on that screen's read.

Cost:

- a policy's cost follows the rows its query reads: add a join, `EXISTS` or subquery correlated with the row through `column()` and `value()`, on indexed columns; look at its SQL too, since a statement that runs to kilobytes is planned again on every read that carries it
- never load the subject's whole history (every source, notice or grant they were ever linked to) to build an `IN` list, and never call another owner's access check per item of it; another package's restriction is a predicate contribution, and another package's grant is a predicate in the owner's policy over facts the owner keeps
- the policy runs on every single-record read, including the read-back after a handle's `create()` and `patch()` (`returning: "record"`, their default) and the lookup before `patch` and `delete`, so a write pays it once per row it writes; the many-row writes check access once per statement
- a write decides access once, inside its transaction; a batch write that would pay an expensive read-back per row follows the data access guide's [Layer 3](../data-access.md#layer-3-many-rows-at-once)
- a hierarchy (descendants, ancestors) is read through a closure table the tree's owner keeps, with one `whereExists` correlated with the row: no builder a policy holds takes a recursive CTE, and MariaDB compiles none that starts at the row being read

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
- count the queries of one read and one write for a subject with a short history and with a realistic long one (hundreds of linked rows), and fail when the count grows with the history

AnyAPI boundary:

- the current JSKIT internal JSON REST host uses normal Knex tables
- do not add speculative backend detection or fallback code
- add an explicit AnyAPI host and domain regression before claiming JSKIT AnyAPI support for a policy

Avoid:

- filtering `document.data` in `service.js`
- accepting visible ids or hierarchy roots from client query parameters
- installing `RowPolicyPlugin` in applications
- adding a default policy file to every CRUD
- returning a Knex builder or promise from a synchronous grouped contribution
- swallowing a policy error and retrying without mandatory visibility
- a policy that reads the subject's history or calls an access check per history item
