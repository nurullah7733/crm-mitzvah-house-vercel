# Setup guide — running this locally

## Prerequisites

- Node.js 20+ (22 recommended) and `npm`, or `bun`
- A Supabase project you control (free tier is fine) — or the Supabase CLI with
  Docker for a fully local database
- `psql` if you want to load `schema.sql` directly

## 1. Get the code

The project is developed in Lovable. Code access for an outside developer is via
**GitHub sync**, which mirrors the repository two-way.

> **The project owner must confirm and, if needed, enable this.** In Lovable, use
> the GitHub button in the top-right of the project (or Project Settings →
> GitHub) to connect the account and create the repository, then add the
> reviewer as a collaborator on GitHub. I cannot see or change the sync state
> from inside the project, so treat this as step zero. If sync is not enabled,
> the alternative is the project's Download / export ZIP option, which gives a
> snapshot with no history.

```bash
git clone <repo-url> mitzvah-house-crm
cd mitzvah-house-crm
npm install
```

## 2. Create the database

Option A — hosted Supabase project (closest to production):

```bash
psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  -f docs/schema.sql
```

Option B — apply migrations in order (preserves history):

```bash
supabase link --project-ref <your-ref>
supabase db push          # runs supabase/migrations/*.sql in filename order
```

Option C — fully local:

```bash
supabase start            # local Postgres + Auth + Studio via Docker
supabase db reset         # applies every migration from scratch
```

`schema.sql` includes the required extensions (`pg_trgm`, `fuzzystrmatch`),
tables, indexes, GRANTs, RLS enablement, policies, functions and triggers.
It contains **no data**.

## 3. Environment variables

Create `.env` in the project root:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
VITE_SUPABASE_PROJECT_ID=<ref>

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-only, never expose
```

The `VITE_*` values are browser-visible by design (the publishable key is safe
to ship — RLS is the access control). `SUPABASE_SERVICE_ROLE_KEY` is read only
inside server functions and must never be given a `VITE_` prefix.

On the production Lovable Cloud deployment these are injected automatically and
the service-role key is not retrievable by anyone, including the project owner.
A reviewer running locally must generate their own key from their own Supabase
project.

## 4. Auth configuration

1. Enable the **Email** provider with password sign-in.
2. **Disable public sign-ups** — this app is invite-only. Create staff users
   from the Auth admin UI, or invite by email.
3. For local development, turn on auto-confirm so invited test users can sign in
   without receiving mail.
4. Set the Site URL / redirect URL to `http://localhost:8080` locally.

There is no anonymous access path: every screen except `/` and `/auth` lives
under the authenticated route gate.

## 5. Run

```bash
npm run dev        # http://localhost:8080
npm run build      # production build (test this — SSR runs on an edge runtime)
```

`npm run dev` runs on Node, which is more permissive than production. Anything
touching server functions should be verified against `npm run build` output,
because the deployed runtime is Cloudflare-Workers-style and lacks
`child_process`, native modules and a real filesystem.

## 6. Seed test data

There is no seed script in the repo — sample data was inserted ad hoc during
development. To get a usable dev environment:

1. Create a staff user in Auth, then insert a matching `staff_members` row
   (**the email must match the login email**, or the greeting and owner fields
   won't resolve) and a `user_roles` row with `admin`:

```sql
insert into public.staff_members (name, email, role) values ('Test Admin','you@example.com','admin');
insert into public.user_roles (user_id, role)
  select id, 'admin' from auth.users where email = 'you@example.com';
```

2. Seed the pick-lists so the Add Person form is usable:

```sql
insert into public.met_source_options (label) values
  ('Farmers market'),('Community event'),('Referred by a friend'),('Synagogue'),
  ('Mitzvah Kitchen'),('Nature center'),('Shabbat dinner'),('Hospital visit'),
  ('Website form'),('Phone inquiry'),('Walk-in'),('Social media');

insert into public.program_options (label) values
  ('Mitzvah Kitchen'),('Jewish Heritage Clubs'),('Shabbat programs'),
  ('Hospital hospitality'),('Mitzvah Bus'),('Chanukah events'),
  ('Matzah campaign'),('Mezuzah campaign'),('Volunteer opportunities');
```

3. Populate contacts through the app's own **Inbox → Import Center** with a
   small CSV. This is the fastest way to get realistic data *and* the best way
   to exercise the riskiest code path in the app. A file with a mix of
   full-name-only rows, "Last, First" rows, a household with two children in one
   row, separate billing and home addresses, and two intentional duplicates will
   exercise nearly all of `lib/import-mapping.ts`.

4. Add a few donations across two calendar years and one gift dated this week,
   so the Tasks screen produces engagement reminders and the giving triggers are
   visibly doing their job.

## 7. Useful checks after setup

```sql
select public.recalculate_all_giving_totals();   -- requires an admin role row
select * from public.find_duplicate_people();
select * from public.search_people('cohen', 20);
select * from public.tag_program_counts();
```

If `search_people` errors, the trigram/fuzzystrmatch extensions did not install.
If `recalculate_all_giving_totals` raises "Only admins can recalculate totals",
the `user_roles` row is missing for your user.
