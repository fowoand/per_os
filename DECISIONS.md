# Decisions

- 2026-11-05: Seed leaves `day_of_month` for saving transfer and debt payment empty because spec sets no day. UI can request dates when those items are paid.
- 2026-11-05: Seed uses `current_balance = NULL` for debt because spec supplies no balance. Debt name is a placeholder until user edits it.
- 2026-11-05: Seed is explicit (`npm run seed`); startup only migrates. This avoids filling a user's empty database with example finances without consent.
- 2026-11-05: Use PostgreSQL via `pg` so the same storage contract can run locally or with a managed database on Vercel. Existing local SQLite file contains no records; no data migration is needed. Public access still requires authentication.
