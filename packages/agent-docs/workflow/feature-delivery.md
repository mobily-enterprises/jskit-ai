# Feature Delivery Workflow

For each feature, follow this order:

1. Scope the feature inside the blueprint.
2. Decide whether it is:
   - package install
   - generator scaffolding
   - custom local code
   - or a combination
3. Implement the smallest correct change.
4. Review for implementation gaps.
5. Review against JSKIT reuse and best practices.
6. Verify with the relevant commands.

During implementation:

- Prefer existing JSKIT helpers over local helper duplication.
- Use generated CRUD/UI scaffolds only after the route and ownership model are decided.
- Keep runtime, UI, and data concerns separated.
- Avoid “while I’m here” scope creep unless it is required for correctness.
