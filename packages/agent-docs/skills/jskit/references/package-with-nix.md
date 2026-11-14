<!-- Generated from `packages/agent-docs/site/guide/app-setup/package-with-nix.md`. -->

# Package an App with Nix

A host that runs apps only as Nix packages builds each one in Nix's sandbox,
with no network access, and runs nothing an app would install for itself.
JSKIT writes that packaging for every JSKIT app; nobody writes Nix for one.

## Write package.nix

```bash
npx jskit package nix
```

It writes `package.nix` at the app's root. Commit it with the app. The file is
the same for every JSKIT app: it reads `package.json` and `package-lock.json`
while Nix evaluates it, so a changed lock file needs no change to it and there
is no hash to keep up to date. Each npm download is fetched by the integrity
hash `package-lock.json` gives it, as a fixed-output fetch, before the build;
the build itself has no network.

The command writes nothing, and says why, when:

- `package-lock.json` names a dependency a build cannot fetch by its hash: one
  from git, a local file (`file:`), one with no integrity hash, or a link to a
  folder outside the app. Publish such a package to a registry, or make it one
  of the app's workspaces;
- `package.json` has no `name` or no `start` script;
- the app has no `package-lock.json`, or one npm 6 wrote (`lockfileVersion` 1);
- a `package.nix` it did not write is there. It never overwrites one.

Plain `jskit check`, and so the app's `npm run verify`, checks a `package.nix`
the command wrote: it must be the one the installed JSKIT writes
(`package/nix-current`: run the command again after `npm run jskit:update`),
and the app must still build with it (`package/nix-manifest`,
`package/nix-offline`). An app with no `package.nix`, or its own, is left
alone.

## What the build does

`package.nix` is a function `{ pkgs }:` of the host's Nixpkgs that returns one
package:

1. Node.js is the major version `engines.node` names first (`26.x` is
   `pkgs.nodejs_26`), else Nixpkgs' default Node.js.
2. The sources are the app's folder without `node_modules`, `.git`, and, at the
   root, `dist`, `.jskit`, `coverage`, test results, `result` links and the
   `.env` files (`.env.example` stays).
3. npm installs `package-lock.json` (`npm ci`) offline, from a cache holding
   exactly the tarballs Nix fetched, then runs the install scripts
   (`npm rebuild`) as `npm ci` would: only those the root `package.json`'s
   `allowScripts` approves, when npm asks for approval. A native addon compiles
   there with node-gyp, against this Node's headers, with Python and a C
   compiler from Nixpkgs. A prebuilt addon, inside its package or a package of
   its own (a `-linux-x64` optional dependency), is a download like any other.
   An install script that downloads something fails, as there is no network.
4. `npm run build` runs when `package.json` has a `build` script (`vite build`
   in a JSKIT app).
5. The dev dependencies leave (`npm prune --omit=dev`), and the app's folder,
   with `dist` and its production `node_modules`, becomes `lib/<name>` in the
   package. Whatever the app runs while it runs must be a dependency, not a
   devDependency: `db:migrate`'s `knex`, for one.

The package is named after `package.json`'s `name` without its scope, as a
program name (`@acme/shop_app` is `shop-app`), with its `version`. On a machine
with Nix:

```bash
nix build --impure --expr 'import ./package.nix { pkgs = import <nixpkgs> { }; }'
```

## Its programs

The package's `bin/` holds the app's programs. Each takes `--env FILE`, a file
of environment variables in Node's `.env` format whose values win over the
environment's. The option is not called `--env-file` because Node reads an
`--env-file` anywhere on its command line, even after the script.

| Program | What it does |
| --- | --- |
| `<name> [--env FILE] [--migrate]` | Runs the app's `start` script as `npm start` would, without npm, in place of itself: from `lib/<name>`, with `node_modules/.bin` and Node first on `PATH`, and `NODE_ENV=production` unless the environment or the file says otherwise. With `--migrate`, runs `db:migrate` first and starts nothing when it fails; an app with no `db:migrate` script has nothing to migrate, so it starts (and says so), and one service command fits every app. |
| `<name>-migrate [--env FILE]` | Runs the `db:migrate` script the same way. Only an app with one has it. |
| `<name>-check [--env FILE] [--wait SECONDS]` | Exits 0 once `GET /api/health` answers 200 on `HOST`:`PORT` (127.0.0.1 when `HOST` is unset or any address; port 3000 when `PORT` is unset), and 1 after `--wait` seconds (60). |
| `<name>-prepare --settings JSON --env FILE [--user NAME]` | Writes the settings, one JSON object of environment variables (each a string, a number or `true`/`false`), as `FILE`, mode 0600, owned by `NAME` (`chown NAME:`). It also makes each folder the settings name for the app's files with an absolute path (`JSKIT_STORAGE_FS_BASE_PATH`, `AUTH_LOCAL_STORE_DIR`, `AUTH_OIDC_STORE_DIR`), mode 0700 when it makes it, owned by `NAME`. It is for a host that hands an app's settings to a step run as root before its services start. |

## Running it

- The app's folder is read-only. A JSKIT package that writes files keeps them
  under the app's folder unless told otherwise, so point those at a writable
  data folder in the settings: `JSKIT_STORAGE_FS_BASE_PATH` (uploads and
  `runtime.storage`; `data/storage` by default), `AUTH_LOCAL_STORE_DIR`
  (local sign-in's files, such as the first account's setup code;
  `.jskit/auth` by default) and, with OIDC sign-in, `AUTH_OIDC_STORE_DIR`.
  `<name>-prepare --user NAME` makes those folders for the user the service
  runs as, so a host's data folder that root owns needs nothing else. With
  `JSKIT_STORAGE_DRIVER=s3`, `runtime.storage` writes to an S3 bucket instead,
  as several instances need.
- Secrets come at run time, in the env file or the service's environment,
  never in the package: anyone who can read the Nix store can read a package.
- The server listens where its `server.js` says: `HOST` (0.0.0.0 in a JSKIT
  app) and `PORT`, whose default differs between apps (3000 or 3001). Set
  `PORT` in the settings, so the server, the check and the host agree.
- The database comes from the app's own settings: `DATABASE_URL`, or
  `DB_CLIENT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`
  (each of these wins over the same part of the URL), as the
  [database layer](database-layer.md) guide says. Set
  `DB_CLIENT` (`pg` or `mysql2`) when the app's own server code picks a
  default for it. `/api/health` answers 200 only while the database answers,
  so a host's check of a new build needs a database too.
- `APP_ENV` says where the app runs: `production`, or `staging` for a copy
  that must not act for real, such as a build-check machine, which leaves the
  `STAGING_*` addresses unset so everything is logged
  ([Environments](environments.md)). The host sets it: the
  package never guesses it, and a server without one refuses to start. The
  programs default `NODE_ENV` to `production`, the build the package holds.
- Behind a load balancer or proxy, `TRUSTED_PROXIES` names its addresses, as
  the [authentication](/guide/app-setup/authentication) guide says, and
  `APP_PUBLIC_URL` is the address people use.

Several instances of one app behind a load balancer need the same settings
on every instance and nothing kept on one server's disk: files in S3,
sessions in the database, the same secrets and setup code, and Redis for live
updates, as [Run on more than one server](/guide/app-setup/more-than-one-server)
says.

## Migrations

Run them in the service: `<name> --migrate`. A host that runs no release step
needs nothing else, and a database that is not up yet only delays the start:
the migration fails, the service exits, and the host's restart tries again.

When several instances start at once, each runs `db:migrate` and Knex's own
lock lets one migrate. Knex takes that lock in the transaction its migrations
run in (every JSKIT migration runs in one), so:

- on PostgreSQL the others wait for that transaction, then find nothing left
  to migrate and start. A migrator that dies has its transaction rolled back,
  its lock with it, and the next start migrates;
- on MySQL and MariaDB a table change commits at once, so the others fail
  (`Migration table is already locked`) and start again once their service
  restarts them, and a migrator that dies part way leaves the lock set until
  `knex migrate:unlock` frees it;
- on a database that has never been migrated, instances that start at the
  same moment can both try to create Knex's own tables: one fails, and its
  restart finds them there.

So every host that starts several instances must restart a failed one, and
migrations must be written to run next to the release before them while a
rollout replaces instances (add first, remove in a later release).

A host that runs apps as Nix packages typically runs the app `shop` as:

- a step run as root at each start, before the service:
  `bin/shop-prepare --settings <the host's settings file> --env /run/shop/env --user shop`;
- one service, run as the user `shop` and restarted when it fails:
  `bin/shop --env /run/shop/env --migrate`, on the port its `PORT` setting
  names, healthy when `/api/health` answers 200;
- a check after it starts: `bin/shop-check --env /run/shop/env`.
