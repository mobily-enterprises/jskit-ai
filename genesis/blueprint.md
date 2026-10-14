# Blueprint

JSKIT is a collection of reusable building blocks, patterns, and guidance for
creating AI-first web applications. It gives application teams consistent ways
to compose server capabilities, authenticated user and workspace experiences,
data-backed resources, integrations, assistants, payments, uploads, realtime
features, and responsive web interfaces without taking ownership away from the
application.

Browser history can paginate user, assistant and system messages separately,
with reasoning and progress retained outside the message allowance. Internal
transcript consumers can continue reading whole stored turns.

The project also publishes developer tooling and documentation that explain how
to assemble, verify, migrate, and release those building blocks. Its public
documentation site is the primary browsable product surface; the packages and
command-line tools are consumed by other projects.

Release preparation selects only packages whose publishable contents changed,
plus necessary dependency and generated catalog/documentation consequences.
Unchanged packages retain their versions and repeated preparation retains suitable
unpublished versions. A dry run calculates the same plan without changing source.
Package publication checks npm before uploading, skips identical existing
releases and rejects changed content under an existing version. Retrying an
interrupted publication uses the same reviewed source and npm's current state.
