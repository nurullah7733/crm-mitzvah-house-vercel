# Known issues, gaps and technical debt

Written to be useful to an auditor, not flattering. Ordered by risk. Nothing
here is hidden from the client — the staff already know the integration story.

## A. Security and access control

1. **RLS is authenticated-or-nothing.** Nearly every table has a single policy —
   `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Any signed-in
   staff member can read and write every record, including deleting donations.
   There is a `user_roles` table and a `has_role()` function, but role checks are
   enforced in exactly one place (`recalculate_all_giving_totals`). Given four
   trusted staff this is a *deliberate* trade-off, not an oversight — but it means
   one compromised staff account exposes the entire donor database, and the
   `admin`/`marketing`/`va` distinction is decorative in the UI.
2. **`anon` holds table-level grants on every public table.** Nothing is
   currently readable anonymously because every policy is `TO authenticated`, so
   the two layers together are safe today. But the grants are far wider than the
   policies, so a single future policy written without `TO authenticated` would
   silently expose that table publicly. Grants should be tightened to
   `authenticated` + `service_role` only.
3. **Integration credentials are stored in plaintext JSONB.** `integration_credentials`
   has RLS enabled with **no policies**, so PostgREST cannot reach it and only the
   service-role server functions can — that part is right. But API keys and OAuth
   secrets sit unencrypted in a normal table (no Vault, no pgsodium, no KMS). A
   database dump is a credential leak. The panel only ever returns a masked
   4-character hint to the browser, which is correct.
4. **Audit purge is manual and unauthenticated by role.** `purge_old_audit_log()`
   deletes anything older than two months, but it only runs when a staff member
   clicks the button in Settings — there is no `pg_cron` schedule. Any signed-in
   user can call it, i.e. any user can destroy two months of change history. It
   should be an admin-gated scheduled job.
5. **No rate limiting or abuse protection** on sign-in beyond Supabase defaults,
   and no session timeout. On a shared phone at an event, an unlocked device is a
   fully signed-in CRM.
6. **Invite-only is UI-only.** The sign-up form was removed from `/auth`, but
   whether public sign-up is actually disabled depends on the Auth provider
   configuration, not on the app code. Verify this at the project level.

## B. Data integrity

7. **`this_year_giving` never rolls over.** It is recomputed only when a donation
   or interaction changes for that person. On 1 January, every contact who does
   not receive a new gift keeps last year's total until something touches them.
   The profile screen recomputes it correctly in the browser, so the visible
   number is right — but list screens, filters and CSV exports that read the
   column are wrong until "Recalculate all totals" is pressed. Needs a scheduled
   annual recalculation.
8. **Soft delete is not enforced by the database.** `deleted_at` exists on
   `people`, `donations`, `events` and `tasks`, and query sites filter
   `deleted_at IS NULL` — but that is a per-query convention, not a constraint or
   a view. Miss the filter on one new query and deleted records reappear.
   Verify: `donations.deleted_at` is *not* respected inside
   `recalc_person_totals` or `search_people`'s donation branches everywhere, so
   soft-deleted gifts can still contribute to totals. Treat this as a live bug.
9. **`merge_people` does not merge everything.** Registrations for the same
   event are de-duplicated by deleting the loser's row — the loser's `status`
   (e.g. `attended`) is discarded in favour of the survivor's. Households are not
   merged at all; merging two people can leave two near-identical households
   behind.
10. **No unique constraints on identity fields.** `people.email` and
    `people.phone` are plain nullable text with no unique index and no
    normalization at write time. Duplicate prevention is entirely detection-based
    (import review, `find_duplicate_people`, the live warning in Add Person). Any
    path that skips those — a direct insert, an API call, a future integration —
    can create duplicates freely. Phone/email normalization happens in queries
    (`regexp_replace`, `lower`), not on storage.
11. **Status/lifecycle fields are free text, not enums.** `tasks.status`,
    `registrations.status`, `campaigns.status`, `grants.stage`,
    `interactions.type`, `people.contact_type` and `people.role` are all `text`
    with defaults and no CHECK constraints. Only `app_role` is a real enum. A typo
    in a stage name creates a silent orphan state.
12. **`field_sources` is not comprehensive.** It records provenance for the
    fields the import pipeline and Add Person form write. Fields edited later
    through profile edit mode land in `audit_log` but do not update
    `field_sources`, so "where did this value come from" can be stale.
13. **Import undo is a hard delete.** `undo_import` deletes rows rather than
    reverting them. If a staff member edited an imported contact and *then* undid
    the import, that edit is destroyed. It also cannot undo *merges* performed
    during that import's review — the loser record is already gone (its snapshot
    survives in `merge_log`, but there is no restore path).

## C. Performance at scale

14. **List screens fetch entire tables into the browser.** `fetchAll()` pages
    past the 1,000-row Data API cap, which fixes correctness but not cost: People,
    Households, Donations, Tasks and the Import Center each pull all matching rows
    and filter/sort/paginate in JavaScript. At 3,000 contacts this is acceptable
    on a laptop; at 10,000 contacts plus a five-year donation ledger it means
    multi-megabyte payloads on a phone over cellular. Filtering, sorting and
    pagination need to move server-side.
15. **Tasks does the most work.** It loads people, donations, interactions,
    tasks and yahrzeits, then derives reach-out dates and engagement reminders in
    the browser on every visit. This is the first screen that will feel slow.
16. **Engagement reminders are computed, never stored.** `lib/engagement.ts`
    derives "went quiet 2/6/12 months", "lapsed donor", "thank you for this
    week's gift" and "check in a month after a gift over $180" fresh on each
    render. Consequences: they cannot be assigned, snoozed or reported on until a
    staff member converts one into a real task; two staff can each act on the
    same reminder; and nothing fires when nobody opens the app.
17. **`search_people` is an expensive function.** It UNIONs a dozen sources
    across people, donations, interactions, tasks, events, households and grants,
    then scores with `similarity`, `word_similarity` and `levenshtein_less_equal`.
    Trigram indexes exist on the main text columns, but the union plus per-row
    Levenshtein will degrade with volume, and it re-scans on every keystroke-level
    query. Needs a materialized search table or `tsvector` column at 10k+.
18. **No `LIMIT` discipline on the timeline.** A person's unified timeline loads
    their entire history; a long-standing monthly donor with fifteen years of
    gifts loads all of it.

## D. Correctness gaps and half-wired features

19. **No integration actually syncs.** Credential storage and status badges are
    real; the data movement is not. There is no webhook endpoint, no polling job,
    no scheduled sync for Donorbox, Stripe, Constant Contact, WordPress, Cognito
    Forms, QuickBooks or Google Sheets. "Test connection" writes a status row and
    does not necessarily prove the provider accepted the credential. Treat the
    whole Integrations panel as scaffolding.
20. **Salesforce migration is unbuilt.** The stated first real-world step is
    moving 3,000+ contacts out of Salesforce. Today that has to go through the
    generic CSV Import Center; there is no Salesforce-specific mapping preset and
    no dry-run against the real export.
21. **No tax/receipting output.** The staff asked for "the most seamless way for
    tax statements". Nothing generates annual giving statements, receipts, or
    per-donation acknowledgements. Only raw CSV export exists.
22. **Grant deadlines do not auto-create tasks.** The Knowledge specifies that
    application/report/renewal deadlines auto-generate tasks. Currently deadlines
    are stored and surfaced on the Dashboard panel, but task creation is manual.
23. **Grant payment vs award is not reconciled.** `donations.grant_id` exists so
    installments attach to a grant, but nothing warns when the sum of received
    payments diverges from `amount_awarded`, and nothing tracks an installment
    schedule.
24. **Campaigns have no UI.** The `campaigns` table, `donations.campaign_id`
    backfill and campaign links are all live in the database, but the list and
    detail routes were deliberately removed at the client's request. Campaign
    progress is therefore not visible anywhere. The legacy free-text
    `donations.campaign` column also still exists alongside `campaign_id` — two
    sources of truth for the same idea.
25. **CSV export coverage is uneven.** People, Households, Events and Donations
    export; Grants, Tasks and Campaigns do not.
26. **"Changes this session" is `sessionStorage` only.** The Dashboard panel is a
    per-tab convenience list, not a report. Closing the tab clears it; it does not
    read `audit_log`, so it will disagree with the real change history.
27. **Staff identity is matched by email string.** `useCurrentStaff()` links the
    signed-in Auth user to a `staff_members` row with `ilike` on email. There is
    no foreign key to the auth user. A staff member whose login email differs from
    their directory email silently gets a name derived from the email prefix, and
    `tasks.owner` / `people.owner` are free-text names rather than references.
28. **Yahrzeit edge cases need a second opinion.** Adar → Adar II in leap years is
    handled, and day-of-month is clamped to the month length (30 Cheshvan/Kislev
    in a short year). What is *not* handled: the traditional rule that a death
    after sunset falls on the next Hebrew day. Dates entered from a Gregorian
    death date may therefore be one day off. This is a domain-correctness risk the
    community will notice.
29. **Duplicate detection is capped.** `find_duplicate_people()` returns
    `LIMIT 200` pairs. With a 3,000-contact Salesforce import that is likely to be
    a partial list with no pagination and no indication that it was truncated.

## E. Code maintainability

30. **Oversized route files.** `people.$personId.tsx` is ~890 lines and
    `inbox.index.tsx` is ~980; `ReviewCompareDialog.tsx` is ~550 and
    `settings.tsx` ~480. These mix data fetching, business rules, formatting and
    layout in one file and are the hardest places to change safely.
31. **`as any` around the service-role client.** `integrations.functions.ts`
    casts `supabaseAdmin as any` in four places, discarding type safety on exactly
    the code path with the most privilege.
32. **No automated tests of any kind.** No unit tests, no integration tests, no
    E2E. The riskiest logic in the app — Hebrew date math, import column mapping,
    merge behaviour, engagement rules — is entirely untested. If an auditor does
    one thing, it should be characterization tests around `lib/hebrew.ts`,
    `lib/import-mapping.ts` and `merge_people`.
33. **Duplicated derivation between client and database.** Giving totals are
    computed both in `recalc_person_totals` and again in the profile component;
    display names are derived in `lib/names.ts` *and* in the
    `sync_person_display_name` trigger. Both pairs can drift.
34. **Unused dependencies from the UI scaffold.** `recharts`,
    `embla-carousel-react`, `input-otp`, `react-resizable-panels` and parts of
    `src/components/ui/` are shipped but unreferenced or barely referenced. Dead
    weight in the bundle and noise in a review.
35. **Formatting helpers live in `AppShell.tsx`**, an oddly load-bearing place for
    them; several screens re-implement date and money formatting locally.
36. **No error monitoring.** Failures surface as `sonner` toasts and console
    errors. Nothing is captured server-side, so a staff member's silent failure at
    an event is invisible afterwards.

## F. Mobile and usability

37. **Import Center on a phone is impractical.** Column mapping and side-by-side
    review are dense desktop layouts. They function on mobile but are not
    genuinely usable there — acceptable, since review is desk work, but worth
    stating.
38. **Long unified timelines have no lazy loading or filtering**, so the most
    valuable screen for a long-standing donor is also the slowest on cellular.
39. **No offline capability.** Records added at an event with poor signal fail
    with a toast; there is no queue or retry.
40. **Accessibility unaudited.** Tap targets were standardized to 44px and inputs
    use 16px to stop iOS zoom, but there has been no contrast, focus-order or
    screen-reader pass. Gold `#F9C348` on white is very likely below WCAG AA.
