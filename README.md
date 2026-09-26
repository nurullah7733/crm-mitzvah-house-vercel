# Mitzvah House CRM

A relationship-management system for a nonprofit: contacts, households, donations,
pledges, grants, events, tasks and a unified activity timeline per person. It
replaces a Salesforce instance the staff found unusable, and is built for a small
non-technical team working largely from phones at community events.

**Live:** [crm-mitzvah-house-vercel.vercel.app](https://crm-mitzvah-house.long-leaf-a244.workers.dev)
(invite-only; sign-in required)

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start (React 19, SSR + server functions), TypeScript |
| Database | PostgreSQL on Supabase (Auth, Row-Level Security, PostgREST) |
| Data fetching | TanStack Query |
| UI | Tailwind CSS v4, shadcn/ui (Radix) |
| Tests | Vitest — unit tests + integration tests against a real database |

## Security model

Access control lives in the database, not the front end. The browser only ever
holds the publishable key; every read and write is checked by Postgres.

- **Row-Level Security enabled on every table** in the `public` schema, with
  explicit per-operation policies.
- **Role-based access** via a `user_roles` table and an `app_role` enum
  (`admin`, `marketing`, `va`). Policies call a `has_role()` function that is
  `SECURITY DEFINER` with a pinned `search_path`, so it can't be hijacked and
  doesn't recurse through RLS.
- **Invite-only auth.** Public sign-up is disabled; there is no anonymous path to
  any data screen.
- **Service-role key is server-only.** It is read only inside server functions
  and never carries a `VITE_` prefix, so it cannot be bundled into the client.
- **Last-admin guard.** Triggers on `user_roles` prevent removing or demoting the
  final admin, so the organization can't lock itself out.
- **Audit log** of record changes, with a retention/purge function.
- Legacy import RPCs are restricted by migration once superseded
  (`restrict_legacy_import_rpcs`).

## Database

- **87 migrations** in [`supabase/migrations`](supabase/migrations), applied in
  filename order.
- [`docs/schema.sql`](docs/schema.sql) — full schema export (tables, indexes,
  grants, RLS, policies, functions, triggers). No data.
- Business rules enforced in Postgres rather than in the UI, for example:
  - `recalc_person_totals` + triggers keep lifetime and this-year giving correct,
    excluding archived gifts.
  - A fingerprint trigger rejects accidental duplicate gifts while allowing
    genuine repeat gifts on different days.
  - `merge_people` / `merge_households` merge records transactionally without
    losing history.
  - Fuzzy duplicate detection with `pg_trgm` and `fuzzystrmatch`.
  - A resumable, lease-claimed import pipeline so a large spreadsheet import can
    fail midway and resume without double-writing rows.

## Project structure

```
src/
  routes/                 file-based routes; everything under _authenticated/ is gated
  components/             UI components
  integrations/supabase/  browser client, server client, auth middleware
  lib/                    domain logic (imports, merges, giving, timeline)
  lib/__tests__/          unit tests
supabase/migrations/      SQL migrations
tests/db/                 integration tests against a real Postgres/Supabase backend
docs/                     technical overview, schema, known issues, setup guide
```

---

## Running locally

**Prerequisites:** Node.js 20+ (22 recommended), and either a Supabase project you
control or the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker.

```bash
git clone https://github.com/nurullah7733/crm-mitzvah-house-vercel.git
cd crm-mitzvah-house-vercel
npm ci
```

Create `.env` in the project root (it is git-ignored):

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_SUPABASE_PROJECT_ID=<ref>

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-only — never prefix with VITE_
```

Then:

```bash
npm run dev     # http://localhost:8080
npm run build   # production build
```

Full database setup, auth configuration and seed SQL are in
[`docs/setup-guide.md`](docs/setup-guide.md).

---

## Tests

There are two layers.

| Suite | Location | Needs a database? | What it proves |
| --- | --- | --- | --- |
| Unit | `src/lib/__tests__/` | No | Import mapping and normalization, merge and review logic, date handling, RPC contracts (~600 tests) |
| Database integration | `tests/db/` | **Yes** | Rules only Postgres can enforce: giving totals, duplicate-gift guard, record merging, reversible thank-you/receipt timeline entries |

### Unit tests

```bash
npm test                  # runs everything; the DB suite skips itself if not configured
npx vitest run src        # unit tests only
npm run test:watch        # watch mode
```

### Database integration tests

These run against a **real** Postgres + Supabase Auth backend, as a signed-in
staff user, so RLS policies, triggers and `SECURITY DEFINER` functions are
exercised exactly as in production. They create records tagged
`vitest-<timestamp>` and delete them in `afterAll`.

> ⚠️ **Never point these at production data.** Use a local stack or a scratch
> Supabase project.

#### Option A — fully local (recommended)

Requires Docker and the Supabase CLI.

**1. Start Postgres + Auth and apply every migration from scratch**

```bash
supabase start      # prints the API URL (http://127.0.0.1:54321) and the publishable/anon key
supabase db reset   # drops the local DB and replays supabase/migrations in order
```

**2. Create a test staff user**

```bash
export TEST_SUPABASE_URL=http://127.0.0.1:54321
export TEST_SUPABASE_PUBLISHABLE_KEY=<publishable key from `supabase start`>

curl -s "$TEST_SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $TEST_SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@example.com","password":"test-password-123"}'
```

**3. Give that user a staff role**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
insert into public.staff_members (name, email, role)
values ('Test Admin', 'test-admin@example.com', 'admin');

insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'test-admin@example.com';
SQL
```

**4. Get an access token for that user**

```bash
export TEST_SUPABASE_ACCESS_TOKEN=$(curl -s \
  "$TEST_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $TEST_SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@example.com","password":"test-password-123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
```

**5. Run the suite**

```bash
npx vitest run tests/db
```

Tear down with `supabase stop`.

#### Option B — a scratch hosted Supabase project

1. Create a new Supabase project and apply the schema, either with
   `supabase link --project-ref <ref> && supabase db push` or with
   `psql "<connection string>" -f docs/schema.sql`.
2. In **Authentication → Users**, create a user; then run the SQL from step 3
   above in the SQL editor.
3. Set `TEST_SUPABASE_URL=https://<ref>.supabase.co` and
   `TEST_SUPABASE_PUBLISHABLE_KEY`, fetch a token as in step 4, and run
   `npx vitest run tests/db`.

#### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TEST_SUPABASE_URL` | Yes | Backend under test |
| `TEST_SUPABASE_ACCESS_TOKEN` | Yes | JWT of a signed-in staff user (expires after about an hour by default; fetch a fresh one if tests fail with 401) |
| `TEST_SUPABASE_PUBLISHABLE_KEY` | No | Defaults to `VITE_SUPABASE_PUBLISHABLE_KEY` |

If `TEST_SUPABASE_URL` or `TEST_SUPABASE_ACCESS_TOKEN` is missing, the suite is
skipped rather than failing, so `npm test` stays green on machines without a
database.

---

## Documentation

| File | Contents |
| --- | --- |
| [`docs/technical-overview.md`](docs/technical-overview.md) | Architecture, data model and business rules |
| [`docs/schema.sql`](docs/schema.sql) | Full schema export |
| [`docs/setup-guide.md`](docs/setup-guide.md) | Detailed local setup and seed data |
| [`docs/secrets-and-credentials.md`](docs/secrets-and-credentials.md) | Every secret by name and purpose (no values) |
| [`docs/known-issues.md`](docs/known-issues.md) | Known gaps, technical debt and scale risks |
| [`docs/review-checklist.md`](docs/review-checklist.md) | Questions for an external code reviewer |
