# Technical overview

## 1. What the app does and who uses it

Mitzvah House CRM is an internal relationship-management tool for Mitzvah House,
a Jewish nonprofit in Atlanta. It replaces a Salesforce instance the staff found
unusable. Every screen is meant to answer one question: *what do we know about
this person, what is their relationship with us, and what should we do next?*

Users: **four staff members** — two directors, a marketing manager, and a
virtual assistant. Low technical comfort, no in-house developer, no training
budget. The VA is a *data reviewer* (approves imports, resolves duplicates), not
a data-entry clerk.

Scale: **~3,000 contacts today, must stay usable past 10,000.** A large share of
record creation happens on a phone at community events, so mobile is a hard
requirement, not a nice-to-have.

Core data rules, which the code follows deliberately:

- The **person** is the atomic record. Donations, registrations, notes, tasks and
  volunteer activity always attach to a person, never to a household.
- **Households** exist only for physical mailings and duplicate detection. A
  household page may show summed giving, but the gifts belong to individuals.
- Every person has **one unified timeline** mixing all activity types
  chronologically — not separate tabs.
- Stored fields record their **source and date** (`field_sources`).
- **Programs** are a property of events surfaced as filter chips, not a section.
- `people` holds individuals *and* organizations/foundations, separated by
  `contact_type`; there is intentionally no `organizations` table.

## 2. Tech stack and versions

| Layer | Choice | Version |
| --- | --- | --- |
| Framework | TanStack Start (React 19, SSR + server functions) | `@tanstack/react-start` 1.168.32, `@tanstack/react-router` 1.170.18 |
| Build | Vite | ^8.2.0 |
| Language | TypeScript | ^5.8.3 |
| Styling | Tailwind CSS v4 (CSS-first config in `src/styles.css`) | ^4.2.1 |
| UI primitives | shadcn/ui on Radix UI | see `package.json` |
| Server state | TanStack Query | ^5.101.1 |
| Backend | Supabase (Postgres 15+, Auth, RLS, PostgREST Data API) | `@supabase/supabase-js` ^2.112.3 |
| Hosting/runtime | Lovable Cloud; SSR + server functions run in a Cloudflare-Workers-style edge runtime | — |
| Hebrew calendar | `@hebcal/core` | ^6.9.2 |
| Fuzzy matching | `fastest-levenshtein` + Postgres `pg_trgm` / `fuzzystrmatch` | ^1.0.16 |
| Spreadsheets | `papaparse` (CSV), `xlsx` (Excel) | ^5.5.4 / ^0.18.5 |
| Toasts | `sonner` | ^2.0.7 |

Design system: Azure `#335AA4`, green `#1FAB6D`, gold `#F9C348`, coral `#EC6951`,
background `#F7F8FA`, text `#22262E`, borders `#E4E8EF`; Poppins headings, Inter
body. All colors are semantic tokens in `src/styles.css`.

## 3. File and folder structure

```
src/
  routes/
    __root.tsx                     root document, fonts, Toaster, auth listener
    index.tsx                      public landing
    auth.tsx                       staff sign-in (invite only, email + password)
    _authenticated/
      route.tsx                    auth gate for the whole subtree (ssr: false)
      dashboard.tsx                needs-attention view, greeting, grant deadlines, session log
      people.index.tsx             list, filter chips, fuzzy filter, tag/program browser, CSV export
      people.$personId.tsx         profile: contact, additional info, giving, special dates,
                                   relatives, unified timeline  (largest file, ~890 lines)
      households.index.tsx / .$householdId.tsx
      events.index.tsx / .$eventId.tsx     program filter chips, attendance, suggested invitees
      donations.tsx                date-range + amount filters, running total
      grants.index.tsx / .$grantId.tsx     grant lifecycle, deadlines, funder/officer
      tasks.tsx                    overdue/upcoming/done, reach-out dates, engagement reminders
      inbox.index.tsx              Import Center (CSV/Excel upload → mapping → import)
      inbox.review.tsx             Data Inbox / review queue (edit, merge, keep both, discard)
      settings.tsx                 staff, lists & labels, integrations, recalculate totals
      search.tsx                   results of the header search bar
  components/
    AppShell.tsx                   header, sidebar, mobile tabs, formatting helpers
    EditableCard.tsx               read/edit-in-place profile card
    ChipEditor.tsx, LabelChips.tsx tag & program editing / clickable chips
    MergeContactsDialog.tsx        manual duplicate merge from a profile
    ReviewCompareDialog.tsx        side-by-side conflict resolution for imports/review
    YahrzeitEditor.tsx             add/edit/remove yahrzeits inside Special dates edit mode
    forms/                         add & edit dialogs, contact picker, field primitives
    settings/IntegrationsPanel.tsx integration credential UI
    ui/                            shadcn components
  lib/
    hebrew.ts        Hebrew date conversion, next birthday, next yahrzeit
    import-mapping.ts column detection, name parsing, household/child grouping, dedupe
    review-merge.ts  history counts + merge helpers for the review queue
    nl-search.ts     natural-language intent parsing + Damerau-Levenshtein fuzzy scoring
    engagement.ts    relationship-reminder rules (quiet contacts, lapsed donors, thank-yous)
    fetch-all.ts     pagination past the 1,000-row Data API cap
    csv.ts           CSV export
    names.ts         display-name helpers
    current-staff.ts who is signed in (matched to staff_members by email)
    session-log.ts   per-session "changes this session" list (sessionStorage)
    integrations.functions.ts  server functions for integration credentials/status
  integrations/supabase/          generated clients, auth middleware, types (do not edit)
supabase/migrations/             every schema change, in order
docs/                            this handover pack
```

## 4. How data flows

**Authentication.** Supabase Auth, email + password, **invite only** (public
sign-up is not offered in the UI). `src/routes/_authenticated/route.tsx` is the
single gate: `ssr: false`, `beforeLoad` calls `supabase.auth.getUser()` and
redirects to `/auth` when there is no user. Session lives in `localStorage`.
Roles live in `user_roles` with a `has_role()` security-definer function;
`staff_members` is a separate directory used for display and assignment.

**Reads.** Almost all reads are direct PostgREST calls from the browser client
(`@/integrations/supabase/client`) inside TanStack Query hooks, under RLS as the
signed-in user. Full-table screens page through results with `fetchAll()`.
Search goes through the `search_people` Postgres function (trigram + Levenshtein)
rather than downloading rows.

**Writes.** Also direct from the browser under RLS, except where correctness
requires a transaction — those are Postgres functions called with `supabase.rpc`:
`merge_people`, `undo_import`, `log_review_decision`,
`log_import_review_merge`, `recalculate_all_giving_totals`, `purge_old_audit_log`.

**Where business logic lives.** Split three ways, deliberately:
1. **Postgres** — money totals, audit trail, merges, import undo, display-name
   sync, search. These must not depend on a browser being open.
2. **`src/lib/*`** — presentation-level rules: reminder derivation, import
   mapping, fuzzy scoring, Hebrew dates.
3. **Route components** — filtering, sorting and layout.

**Audit trail.** `record_audit()` triggers on `people`, `donations`, `events`,
`tasks`, `campaigns`, `grants` write field-level before/after diffs to
`audit_log`, with actor id and email from the JWT. Retention is two months via
`purge_old_audit_log()` (called from Settings — see known issues).

## 5. Third-party dependencies and why

- `@supabase/supabase-js` — database, auth, RPC.
- `@tanstack/react-router` / `react-start` — routing, SSR, server functions.
- `@tanstack/react-query` — caching, refetching, invalidation after writes.
- `@hebcal/core` — **all** Hebrew calendar math. Never hand-rolled; errors here
  are unacceptable to the community.
- `papaparse`, `xlsx` — CSV and Excel parsing for the Import Center.
- `fastest-levenshtein` — client-side fuzzy list filtering (server side uses
  Postgres `pg_trgm` + `fuzzystrmatch`).
- `lucide-react` — icons. `sonner` — toasts. `vaul` — mobile bottom sheets.
- Radix UI + `class-variance-authority`, `clsx`, `tailwind-merge` — shadcn/ui.
- `react-hook-form`, `@hookform/resolvers`, `zod` — form and input validation.
- `date-fns`, `react-day-picker` — date pickers and formatting.
- `recharts`, `embla-carousel-react`, `cmdk`, `input-otp`,
  `react-resizable-panels`, `tw-animate-css` — shipped with the shadcn scaffold;
  **only some are actually used** (see known issues: unused dependency debt).

## 6. Server-side functions

**There are no Supabase Edge Functions.** `supabase/functions/` does not exist.
Server logic is TanStack server functions plus Postgres functions.

TanStack server functions (`src/lib/integrations.functions.ts`, guarded by
`requireSupabaseAuth`, loading the service-role client inside the handler):

| Function | Trigger | Touches |
| --- | --- | --- |
| list/status | Settings → Integrations opens | `integration_credentials` (existence + masked hint only), `integration_events` |
| save credentials | staff submits a provider form | writes `integration_credentials` |
| clear credentials | staff disconnects a provider | deletes from `integration_credentials` |
| test connection | staff clicks "Test" | writes an `integration_events` row |

Postgres functions doing real work: `recalc_person_totals`,
`donations_refresh_totals`/`interactions_refresh_totals` (triggers),
`recalculate_all_giving_totals`, `merge_people`, `find_duplicate_people`,
`search_people`, `tag_program_counts`, `undo_import`, `log_review_decision`,
`log_import_review_merge`, `record_audit`, `sync_person_display_name`,
`purge_old_audit_log`, `has_role`. Full bodies are in `schema.sql`.

## 7. How giving totals are calculated

Totals are **database-owned**. `donations` and `interactions` have AFTER
INSERT/UPDATE/DELETE triggers that call `recalc_person_totals(person_id)`, which
recomputes from the ledger:

- `lifetime_giving` = SUM(amount) of that person's donations
- `this_year_giving` = SUM(amount) where the donation year = current calendar year
- `last_gift_amount` / `last_gift_date` = most recent gift
- `last_activity_date` = latest of last gift and last interaction

The person profile *also* recomputes lifetime and this-year in the browser from
the fetched donation rows, so what a staff member sees on the profile is derived
live rather than trusted from the column. `merge_people` recalculates the
survivor. Settings has an admin-only **Recalculate all totals** button
(`recalculate_all_giving_totals`, gated on `has_role(auth.uid(),'admin')`).

Known caveat: `this_year_giving` is only correct until the calendar flips —
nothing re-runs on January 1. See known issues.

## 8. Import pipeline and duplicate matching

1. **Upload** (`inbox.index.tsx`) — CSV via `papaparse`, Excel via `xlsx`,
   parsed entirely in the browser. The in-progress mapping draft is written to
   `sessionStorage` so a slow upload or a timeout doesn't lose the work.
2. **Column detection** (`lib/import-mapping.ts`) — header matching handles the
   real shapes staff receive: separate first/last, single full-name column,
   "Last, First", titles, last-name-only, billing vs home address, structured
   address parts (line 2/3, city, state, ZIP, county), school, free-text notes,
   and multiple children in one row.
3. **Grouping** — rows are grouped into households; children become their own
   person records linked to the same household, so a family signing up together
   imports as one household plus several people.
4. **Duplicate detection** — within the file (same name/email/phone appearing
   twice) and against the database. Anything ambiguous goes to `review_queue`
   instead of being written blindly.
5. **Review** (`inbox.review.tsx` + `ReviewCompareDialog.tsx`) — side-by-side
   "Already in CRM" vs "Incoming". Identical fields collapse; one-sided values
   are kept automatically; only true conflicts ask for a radio choice, with
   "use all from CRM / all incoming" shortcuts and a live preview of the result.
   Actions: **Merge**, **Keep both**, **Edit**, **Discard with a required
   reason** — every one logged to `audit_log`.
6. **Merging** — `merge_people` runs in one transaction: re-points donations,
   interactions, registrations (de-duplicating same-event rows), tasks,
   field_sources, yahrzeits, grant funder/officer links and child contacts,
   applies chosen field values, deletes the loser, recalculates totals, and
   writes both original records into `merge_log` and `audit_log`. Field choices
   change values only — history is never discarded.
7. **Undo** — every created row carries `import_batch_id`; `undo_import(batch)`
   deletes exactly that batch's rows and marks the batch `reverted`.

Server-side duplicate suggestions come from `find_duplicate_people()`
(same email, same phone by last 10 digits, or same name in the same household).

## 9. Hebrew date and yahrzeit logic

All of it is `@hebcal/core` in `src/lib/hebrew.ts`:

- `hebrewDateFromEnglish()` converts a Gregorian birthday/anniversary to a
  Hebrew date string for display.
- `hebrewMonthDayFromEnglish()` converts an entered English date into a Hebrew
  month + day for storage.
- `nextBirthday()` — next Gregorian occurrence, with days remaining.
- `nextYahrzeit(month, day)` — walks the current and next two Hebrew years,
  clamps the day to the month length, and returns the next Gregorian date plus
  days remaining. **In a Hebrew leap year an Adar (12) yahrzeit resolves to
  Adar II (13)**; an Adar II date in a non-leap year falls back to Adar.

Yahrzeits are stored as `hebrew_month` (1–13) + `hebrew_day` in the `yahrzeits`
table, one row per remembered person, with `deceased_name` and `relationship`,
so they recur on the Hebrew calendar. Birthday and anniversary are single date
columns on `people`. All three are grouped as "Special dates" on the profile and
feed the Tasks reach-out list for the next 31 days.

## 10. Integrations — actual current state

**None of these move data yet.** The Integrations panel stores credentials and
records status; there is no sync job, webhook receiver, or scheduled import for
any provider.

| Provider | Intended | Actually built |
| --- | --- | --- |
| Donorbox | donations in | credential storage + status only |
| Stripe | card processing | credential storage + status only |
| Constant Contact | two-way email/consent sync (CC authoritative for unsubscribes) | credential storage only |
| WordPress | website form intake | secret storage only, no endpoint |
| Cognito Forms | registrations in | secret storage only, no endpoint |
| QuickBooks | bookkeeping out | credential storage only |
| Google Sheets | two-way | not built; CSV/Excel import and CSV export cover this today |
| Salesforce | one-time historical import | not built; use the CSV Import Center |

Working today: CSV/Excel import, CSV export on People, Households, Events,
Donations, Grants, and Tasks.
