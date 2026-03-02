# Database Migrations and Seeds

Last validated: 2026-02-25 (UTC)

## Commands

- Run migrations: `npm run -w apps/jskit-value-app db:migrate`
- Roll back latest migration batch: `npm run -w apps/jskit-value-app db:rollback`
- Run all seeds: `npm run -w apps/jskit-value-app db:seed`
- Run users seed: `npm run -w apps/jskit-value-app db:seed:users`
- Run calculator seed: `npm run -w apps/jskit-value-app db:seed:calculator`

## Source Locations

- Baseline migration entry:
  - `apps/jskit-value-app/migrations/20260224000000_baseline_schema.cjs`
- Baseline migration step files:
  - `apps/jskit-value-app/migration-baseline-steps/`
- Forward migration entries:
  - `apps/jskit-value-app/migrations/*.cjs` after baseline (for example, `20260225000000_create_user_alerts_forward.cjs`)
- Seed files:
  - `apps/jskit-value-app/seeds/`

## Notes

- Migrations are intentionally explicit and are not run automatically at app boot.
- Run migrations before any seed command.
- Seed files in this repo are scaffolding-oriented and may be intentionally minimal/no-op depending on environment policy.
