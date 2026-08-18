# Known issues, gaps and technical debt

Written to be useful to an auditor, not flattering. Ordered by risk.
Last reviewed 2026-08-18 against the live database and the current code.

Resolved items from earlier revisions are listed in section G so a reviewer can
see what changed rather than wondering whether it was quietly dropped.

## A. Security and access control

1. **RLS is authenticated-or-nothing.** Almost every table has one policy —
   `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Any signed-in staff
   member can read and write every record. A `user_roles` table, `has_role()` and
   `is_admin()` exist, and admin gating is now real for privileged RPCs
   (`recalculate_all_giving_totals`, `undo_import`, staff invite/delete, hard
   deletes) — but for ordinary CRUD the `admin` / `marketing` / `va` distinction is
   still decorative. One compromised staff account exposes the whole donor
   database.
2. **Integration credentials are stored in plaintext JSONB.**
   `integration_credentials` has RLS with no policies, so only service-role server
   functions reach it, and the browser only ever sees a 4-character masked hint —
   that part is right. But keys sit unencrypted in a normal table (no Vault
   encryption, no KMS). A database dump is a credential leak.
3. **No rate limiting, no session timeout** beyond Supabase defaults. On a shared
   phone at an event, an unlocked device is a fully signed-in CRM.
4. **Invite-only is enforced in the UI and by the invite server functions**, but
   whether public sign-up is truly disabled depends on Auth provider
   configuration, not app code. Re-verify at the project level after any change.
5. **`purge_old_audit_log()` is callable by any signed-in user.** It is now also
   scheduled (`pg_cron`, daily 03:15 UTC), but the manual entry point still lets a
   non-admin destroy change history.

## B. Data integrity

6. ~~Soft delete is a per-query convention~~ — **fixed 2026-08-19.** `people`,
   `donations`, `events` and `tasks` now have split RLS policies: `SELECT` is
   `USING (deleted_at IS NULL)`, while insert/update/delete are unchanged. A query
   that forgets `deleted_at IS NULL` can no longer see removed rows, and the same
   applies inside the `SECURITY INVOKER` report functions (`search_people`,
   `lapsed_donors`, `find_duplicate_people`, `giving_total_mismatches`,
   `tag_program_counts`). Restore still works because it is an `UPDATE`.
   Remaining caveat: `SECURITY DEFINER` functions (`merge_people`,
   `merge_households`, `recalc_person_totals`, triggers) bypass RLS by design and
   must keep filtering explicitly.
   Because a removed row is invisible even to the query that removed it, remove
   and restore now go through `archive_records()` / `restore_records()`
   (`src/lib/archive.ts`); nothing writes `deleted_at` directly any more, and the
   admin-only trigger still gates removal.
7. **Duplicate donations can still slip through as a *different person*.**
   Dedupe is now solid within a person: `donations.import_fingerprint` plus a
   unique index, and app-level checks in the import loop, quick-merge and review
   create paths. But every check is keyed on `person_id`. If person-matching fails
   and a second contact is created, the same gift lands on the second record and
   passes every guard. There is no "same amount, same date, different contact"
   detector. Manually entered gifts (`import_batch_id IS NULL`,
   `import_fingerprint IS NULL`) have no database-level protection at all.
8. **Two independent "is this a duplicate" implementations.** The import preview
   flags repeats with `rowDedupeKey`; the processing loop matches with `matchRow`
   against a live in-batch registry. They can disagree, and neither is tested.
9. **Select-then-insert races.** All dedupe checks for gifts, registrations and
   contact methods read before writing without a transaction or lock. A
   double-submitted or retried import can pass both checks; only the unique
   indexes catch it, and a raised unique violation surfaces as an import error
   rather than a graceful skip.
10. **Attendance status is not always upgraded.** `gift-events.ts::recordAttendance`
    upgrades an existing `Registered`/`Invited` row to `Attended`; the inline copy
    inside the bulk importer and `review-quick.ts` only skip when a row exists, so
    re-importing an attendee list over seeded RSVPs leaves people non-attended —
    and therefore missing from the timeline.
11. ~~`merge_people` loses information~~ — **fixed 2026-08-19.** Duplicate
    registrations for the same event now keep the stronger outcome via
    `registration_status_rank()` (attended > no_show > registered) before the
    loser's row is removed, so attendance survives a merge. When the two contacts
    sit in different households, the merge dialog offers to combine those
    households too (calls `merge_households` right after `merge_people`).
12. **No unique constraints on identity fields.** `people.email` / `people.phone`
    are plain nullable text (deliberately — the unique email constraint blocked
    merges and was dropped). Duplicate prevention is entirely detection-based, so
    any path that skips detection can create duplicates.
13. ~~Status/lifecycle fields are free text~~ — **already constrained (verified
    2026-08-19).** `tasks.status`, `registrations.status`, `campaigns.status`,
    `grants.stage`, `interactions.type`, `people.contact_type`, `people.role` and
    `households.status` all carry CHECK constraints, and every stored value is
    valid. One app-side violation was found and fixed: the Renewals screen wrote
    `tasks.status = 'open'`, which the constraint rejects, so bulk renewal task
    creation failed outright; it now writes `upcoming`.
14. **`field_sources` is not comprehensive.** Provenance is written by the import
    pipeline, the add forms and review merges. Later edits through profile edit
    mode land in `audit_log` only, so "where did this value come from" can be
    stale.
15. **Import undo is a hard delete.** `undo_import` now removes every
    batch-tagged record (people, households, contact methods, donations,
    interactions, registrations, tasks, field sources, review rows), which fixed
    the leftovers — but it deletes rather than reverts. Staff edits made to an
    imported contact after the import are destroyed with it, and merges performed
    during review cannot be undone (the snapshot survives in `merge_log`, with no
    restore path).

## C. Performance at scale

16. **List screens fetch entire tables into the browser.** `fetchAll()` pages past
    the 1,000-row API cap, so results are correct, but People, Households,
    Donations, Tasks, Renewals and the Import Center each pull all matching rows
    and filter/sort/paginate in JavaScript. Fine at 3,000 contacts on a laptop;
    multi-megabyte payloads on a phone at 10,000 contacts plus a multi-year
    ledger. Filtering, sorting and pagination need to move server-side.
17. **Tasks does the most work of any screen** — people, donations, interactions,
    tasks and yahrzeits, then derives reach-outs, milestones and engagement
    reminders in the browser on every visit. First screen that will feel slow.
18. **Engagement and lifecycle reminders are computed, never stored.**
    `lib/engagement.ts` and `lib/lifecycle.ts` derive quiet-contact, lapsed-donor,
    thank-you, birthday/anniversary and bar/bat-mitzvah prompts on each render.
    They cannot be assigned, snoozed or reported on until someone converts one
    into a real task; two staff can act on the same reminder; nothing fires when
    nobody opens the app.
19. **`search_people` is expensive.** It UNIONs a dozen sources and scores with
    `similarity`, `word_similarity` and `levenshtein_less_equal`. Trigram indexes
    help, but it re-scans per query and will need a materialized search table or
    `tsvector` column at 10k+ contacts.
20. **No `LIMIT` on the person timeline.** A fifteen-year monthly donor loads
    their whole history at once, with no lazy loading or type filter.

## D. Correctness gaps and half-wired features

21. **No integration actually syncs.** Credential storage, masked hints, status
    badges and event logging are real; data movement is not. There is no webhook
    endpoint, polling job or scheduled sync for Donorbox, Stripe, Constant
    Contact, WordPress, Cognito Forms, QuickBooks or Google Sheets. "Test
    connection" records an attempt and does not prove the provider accepted the
    credential. Treat the Integrations panel as scaffolding.
22. **Salesforce migration is unbuilt.** No Salesforce-specific mapping preset and
    no dry run against a real export; it has to go through the generic CSV
    importer.
23. **No tax statement or receipt output.** Donations track `thank_you_sent` and
    `receipt_sent` flags with dates, reversible in one click, and filter views for
    what is pending — but nothing *generates* an annual giving statement, a
    receipt PDF or an acknowledgement letter. Only raw CSV.
24. **Campaigns have no UI.** The `campaigns` table, `donations.campaign_id` and
    the backfill are live; the list and detail routes were removed at the client's
    request. Campaign progress is therefore invisible in the app, and the legacy
    free-text `donations.campaign` column still exists alongside `campaign_id` —
    two sources of truth.
25. **Grant money is not reconciled.** `donations.grant_id` lets installments
    attach to a grant, but nothing warns when received payments diverge from
    `amount_awarded`, and there is no installment schedule.
26. **CSV export coverage is uneven per screen.** People, Households, Events,
    Donations and Renewals have export buttons; Grants, Tasks and Campaigns do
    not. The Settings ZIP backup does cover all 17 tables, so the data is
    reachable — just not from those screens.
27. **"Changes this session" is `sessionStorage` only.** A per-tab convenience
    list, not a report; it never reads `audit_log`, so it disagrees with the real
    change history.
28. **Staff identity is matched by email string.** `useCurrentStaff()` links the
    Auth user to a `staff_members` row with `ilike` on email (`user_id` exists but
    is not a foreign key to auth and is not always populated). `tasks.owner` and
    `people.owner` are free-text names, not references.
29. **Yahrzeit edge case unhandled.** Adar → Adar II in leap years is handled, and
    day-of-month is clamped for short Cheshvan/Kislev. The traditional rule that a
    death after sunset falls on the next Hebrew day is *not* handled, so dates
    entered from a Gregorian death date may be one day off. The community will
    notice this.
30. **Duplicate detection is capped.** `find_duplicate_people()` returns
    `LIMIT 200` pairs, with no pagination and no signal that it truncated.
31. **Address-only households are surfaced but not policed.** Doorstep add,
    geolocation capture, "incomplete" status and a follow-up task all exist;
    nothing chases the task if it is never completed, so incomplete households can
    accumulate silently.

## E. Code maintainability

32. **Oversized route files.** `inbox.index.tsx` is ~1,840 lines,
    `people.$personId.tsx` ~1,040, `inbox.review.tsx` ~850, `settings.tsx` ~640,
    `ReviewCompareDialog.tsx` ~610. Data fetching, business rules, formatting and
    layout are mixed in one file; these are the hardest places to change safely.
33. **`as any` around the service-role client.** `integrations.functions.ts` casts
    `supabaseAdmin as any` in four places — type safety discarded on the most
    privileged path.
34. **No automated tests of any kind.** No unit, integration or E2E tests. The
    riskiest logic — Hebrew date math, import column mapping, dedupe/fingerprints,
    merge behaviour, engagement rules — is untested. Highest-value first step for
    any reviewer.
35. **Duplicated derivation between client and database.** Giving totals are
    computed in `recalc_person_totals` and again in the profile component; display
    names in `lib/names.ts` and in the `sync_person_display_name` trigger. Each
    pair can drift.
36. **Unused scaffold dependencies** still shipped: `recharts`,
    `embla-carousel-react`, `input-otp`, `react-resizable-panels`, and much of
    `src/components/ui/`.
37. **Formatting helpers live in `AppShell.tsx`**, and several screens
    re-implement date/money formatting locally.
38. **No error monitoring.** Failures surface as toasts and console errors;
    nothing is captured server-side, so a silent failure at an event is invisible
    afterwards.

## F. Mobile and usability

39. **Import Center and side-by-side review are desktop-first.** They function on
    a phone but are dense; acceptable because review is desk work, worth stating.
40. **No offline capability.** A record added with poor signal fails with a toast;
    there is no queue or retry.
41. **Accessibility unaudited.** 44px tap targets and 16px inputs are in place,
    but there has been no contrast, focus-order or screen-reader pass. Gold
    `#F9C348` on white is very likely below WCAG AA.
42. **Long timelines have no filtering**, so the most valuable screen for a
    long-standing donor is also the slowest on cellular.

## G. Previously listed, now fixed (verified 2026-08-18)

- `anon` no longer holds table-level grants on any public table (checked against
  `information_schema.role_table_grants`: zero rows).
- Audit purge and the 1 January giving-total reset are both scheduled `pg_cron`
  jobs (`purge-audit-log`, `new-year-giving-totals-reset`), so `this_year_giving`
  now rolls over without a manual click.
- Grant application/report/renewal deadlines auto-create tasks when a grant is
  saved (`CampaignGrantDialogs.tsx`).
- `merge_households` exists, is admin-audited, and moves members before deleting.
- `registrations(event_id, person_id)` now has a unique index; donations have a
  unique `import_fingerprint` index.
- `undo_import` cleans up every batch-tagged table, so reverted imports no longer
  leave orphaned people, tasks, registrations or review rows.
- Thank-you and receipt flags are fully reversible: unchecking clears flag and
  date, reopens the task and removes the timeline entry (database triggers, not
  client-side steps).

## Automated tests

Run `npm test`. 119 unit tests cover Hebrew dates, import column mapping and row
building, duplicate-gift fingerprints, and event attendance. 7 backend tests in
`tests/db/` cover merging, giving totals, the duplicate guard and thank-you
reversal; they only run when a test backend is configured (see tests/db/README.md).
