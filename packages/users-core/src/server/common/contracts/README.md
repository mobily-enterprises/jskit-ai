`common/contracts` is for server-side contract files shared by multiple route slices.

Put a file here when all of these are true:
- it describes server transport contracts or route contract parts
- more than one server slice uses it
- it is not owned by one single feature

Good examples:
- shared route params like `workspaceSlug`, `memberUserId`, `inviteId`, `provider`
- shared route query parts like pagination or oauth return-to
- route-side aggregate contracts reused by multiple route builders

Do not put these here:
- resource schemas owned by one domain feature in `src/shared`
- feature services
- feature actions
- feature controllers
- client contracts

Rule for juniors:
- if the contract is shared by several server route slices, put it here
- if it belongs to one feature only, keep it inside that feature
