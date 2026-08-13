# Mitzvah House CRM — handover pack for an external code review

Everything a third-party developer needs to audit this application. Nothing in
this folder contains secret values.

| File | What it is |
| --- | --- |
| `technical-overview.md` | What the app is, stack, structure, data flow, business logic |
| `schema.sql` | Complete database schema export — recreates the database from scratch |
| `known-issues.md` | Honest list of gaps, bugs, debt, and scale risks (read this one) |
| `setup-guide.md` | How to run the app locally and seed test data |
| `secrets-and-credentials.md` | Every secret by name and purpose, plus storage concerns |
| `review-checklist.md` | Ranked questions we most want a second developer to answer |

Generated 2026-08-13. Regenerate `schema.sql` after any migration.
