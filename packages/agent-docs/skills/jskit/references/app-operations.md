# Application operations

Read this reference for application creation, CLI discovery, package changes,
and generator selection.

## Create an application

Confirm the application name and tenancy mode, then run:

```bash
npx @jskit-ai/create-app <app-name> --tenancy-mode <tenancy-mode>
cd <app-name>
npm install
```

Generated applications require Node.js 26. Use `--target . --force` only to
promote a known JSKIT `ai-seed` directory, never to overwrite an arbitrary
application. Use `--minimal` only for a deliberately bare package-development
or unusual integration baseline. After creation, follow the generated
`AGENTS.md`.

After the initial `npm install`, use `npx --no-install jskit ...`. This makes a
missing or stale local CLI visible instead of silently downloading a different
version.

Do not add authentication, users, workspaces, console, example routes, sample
records, or another database adapter unless the request requires them.

## Fresh minimal database CRUD ordering

For a minimal app whose first feature is generated from a live table, use this
order exactly:

1. create the app
2. run `npm install`
3. add the selected database runtime
4. run `npm install`
5. create the live table in a fresh disposable development database
6. run `crud-server-generator scaffold`
7. run `npm install`
8. run `crud-ui-generator crud`

For example:

```bash
npx @jskit-ai/create-app notes \
  --target . \
  --force \
  --tenancy-mode none \
  --minimal
npm install
npx --no-install jskit add package database-runtime-mysql
npm install
# Create and select a fresh disposable database, then create the live `notes` table.
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

The server generator installs its complete package dependency closure. Do not
pre-install `shell-web` as a workaround for placement ownership.

## Select and apply technology

- Inspect available capabilities with `npx --no-install jskit list` and inspect
  a specific entry with `npx --no-install jskit show <id> --details`.
- Install reusable runtime capability with
  `npx --no-install jskit add package <id>`.
- Inspect a bundle before installing it with
  `npx --no-install jskit add bundle <id>`.
- Run tooling packages with
  `npx --no-install jskit generate <generator> <action> ...`; do not install
  generators as runtime packages.
- Let `jskit` own JSKIT application mutations, use `npm install` for dependency
  installation, and use `npm run db:migrate` for database migrations.
- Review generated files and continue only at documented app-owned seams.

Packages own reusable framework behavior. Generators create application-owned
pages, components, placements, migrations, and support files. Prefer the
narrowest installed package or generator that implements the requested
vertical slice; do not build a parallel local framework around it.
