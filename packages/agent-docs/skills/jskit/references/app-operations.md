# Application operations

Read this for app creation, CLI discovery, packages, and generators.

## Create an application

Confirm the name and tenancy mode:

```bash
npx @jskit-ai/create-app <app-name> --tenancy-mode <tenancy-mode>
cd <app-name>
npm install
```

Generated apps require Node.js 26. Use `--target . --force` only to promote a
known JSKIT `ai-seed`, never to overwrite an arbitrary app. `--minimal` is for
deliberately bare package-development or unusual integrations. Follow the
generated `AGENTS.md`.

After the first install, use `npx --no-install jskit ...`; a missing local CLI
must fail instead of silently fetching another version. Do not add auth, users,
workspaces, console, sample data, or another database adapter unless requested.

## Fresh minimal database CRUD order

Use this order exactly: create-app, install, add the database runtime, install,
create the live table in a fresh disposable development database, generate the
server CRUD, install, then generate the UI.

```bash
npx @jskit-ai/create-app notes \
  --target . --force --tenancy-mode none --minimal
npm install
npx --no-install jskit add package database-runtime-mysql
npm install
# Create/select a fresh disposable database and create its live `notes` table.
npx --no-install jskit generate crud-server-generator scaffold \
  --namespace notes \
  --surface home \
  --ownership-filter public \
  --access public \
  --table-name notes
npm install
npx --no-install jskit generate crud-ui-generator crud notes \
  --resource-file packages/notes/src/shared/noteResource.js \
  --id-param noteId \
  --display-fields title,body \
  --parent-title contextual \
  --navigation-role primary \
  --delete-confirmation
```

The server generator owns its dependency closure. Do not pre-install
`shell-web` as a placement workaround.

## Select and apply technology

- Discover with `npx --no-install jskit list` and
  `npx --no-install jskit show <id> --details`.
- Install runtime capability with `npx --no-install jskit add package <id>`;
  inspect a bundle before adding it.
- Run tooling with `npx --no-install jskit generate <generator> <action> ...`;
  do not install generators as runtime packages.
- JSKIT owns app mutations, npm owns dependency installation, and
  `npm run db:migrate` owns database migration execution.
- Continue only at documented app-owned seams. Prefer the narrowest existing
  package or generator over a parallel local framework.
