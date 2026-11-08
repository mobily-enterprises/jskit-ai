<!-- Generated from `packages/agent-docs/heuristics/row-policies.md`. -->

# Row Policies

Use when:

- mandatory record visibility needs `OR`, `EXISTS`, joins, memberships, or hierarchy traversal
- filtering after pagination produces empty or incomplete pages
- another package grants access to a resource but a reverse dependency would create a cycle
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
5. Derive identity from trusted execution context.
6. Group every policy-owned `OR` branch.
7. Return `true` after adding the predicate, return `false` to deny all rows, or throw for invalid trusted context.
8. Keep action permissions for writes; visibility is not mutation authorization.

Package composition:

- the feature that owns the resource also owns the row policy
- the owner accepts contributions with `{ resource, rowPolicy, acceptsContributions: true }` in `owns`
- a package that grants extra visibility depends on the resource owner and calls `resources.contributeRowPolicy(name, policy)` on the handles its own `owns` gave it; a contribution is ANDed with the owner's policy inside its own group, so it can only narrow
- the resource owner does not import grant packages
- do not use module-global mutable registries

Example, "your rooms or shared rooms":

```js
owns: [{
  resource: roomResource,
  acceptsContributions: true,
  rowPolicy({ query, context, column, ownTable }) {
    const userId = resolveActorId(context);
    if (!userId) return false;
    query.where((rooms) => rooms
      .where(column("shared"), true)
      .orWhereIn(column("id"), ownTable("roomMembers").select("room_id").where("user_id", userId)));
    return true;
  }
}]
```

A system context (`systemScope`, `systemContext(reason)`) reaches the policy as
`system: true`; the policy decides what a job sees and says why.

Cost:

- a policy's cost follows the rows its query reads: add a join, `EXISTS` or subquery correlated with the row through `column()` and `value()`, on indexed columns; look at its SQL too, since a statement that runs to kilobytes is planned again on every read that carries it
- never load the subject's whole history (every source, notice or grant they were ever linked to) to build an `IN` list, and never call another owner's access check per item of it; another package's grant is a predicate contribution
- the policy runs on every single-record read, including the read-back after a handle's `create()` and `patch()` (`returning: "record"`, their default) and the lookup before `patch` and `delete`, so a write pays it once per row it writes; the many-row writes check access once per statement
- a write decides access once, inside its transaction; a batch write that would pay an expensive read-back per row follows the data access guide's [Layer 3](../data-access.md#layer-3-many-rows-at-once)

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
