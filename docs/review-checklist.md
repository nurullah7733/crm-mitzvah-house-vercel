# Review checklist — what we most want answered

Ranked by how much the answer would change our plans. Please answer in this
order; if you only have a day, stop after section 1.

## 1. Before we migrate 3,000+ contacts out of Salesforce (highest stakes)

This import is the next real-world action. Getting it wrong contaminates the
database permanently.

- [ ] Read `src/lib/import-mapping.ts` end to end. Does the column detection and
      name parsing survive a real Salesforce contact export? Where does it
      silently mis-assign a value rather than flagging it for review?
- [ ] Multi-person rows: a parent plus two children in one CSV row should become
      three people in one household. Verify with a real file. What happens with
      three or more children, missing child last names, or a child with the same
      first name as a sibling?
- [ ] Address handling: line 2/3, city, state, ZIP, county, and a billing address
      that differs from the home address. Anything dropped?
- [ ] In-file duplicate detection: two identical rows, and two rows that are the
      same person with different formatting (nickname, changed email, phone with
      an extension). Do both reach `review_queue`?
- [ ] `undo_import(batch_id)`: import 200 rows, edit three of them, merge two
      during review, then undo. What is lost? Is the result clean or a partial
      state? (We believe edits are destroyed and merges are unrecoverable — see
      known-issues 13.)
- [ ] Recommend a concrete pre-flight procedure for the Salesforce file: what to
      clean before upload, what to import in what order (households? donations
      after people?), and how to verify the result.
- [ ] Should historical Salesforce donations be imported as `donations` rows at
      all, given the totals triggers will fire per row? Is there a volume at which
      that becomes a problem?

## 2. Data integrity

- [ ] Confirm or refute: soft-deleted donations (`deleted_at IS NOT NULL`) still
      contribute to `lifetime_giving` because `recalc_person_totals` does not
      filter them. If confirmed, this is a money-visible bug — how would you fix
      it without breaking the existing triggers?
- [ ] `this_year_giving` does not reset on 1 January. Best fix: scheduled
      recalculation, a generated/derived value, or a view?
- [ ] Read `merge_people` in `docs/schema.sql`. Can it lose data? Specifically:
      registration status when both records attended the same event, and orphaned
      duplicate households.
- [ ] Should we add unique/normalizing constraints on `people.email` and
      `people.phone`, or is detection-only correct for a CRM where two family
      members genuinely share an email?
- [ ] Should the free-text status fields (`tasks.status`, `grants.stage`,
      `registrations.status`, `campaigns.status`, `interactions.type`,
      `people.contact_type`) become enums or CHECK constraints? What breaks if we
      do it now versus later?
- [ ] Is soft delete safe as a per-query convention, or should it be enforced with
      views / RLS predicates?

## 3. Hebrew calendar correctness (domain risk, not just technical)

- [ ] Review `src/lib/hebrew.ts` against `@hebcal/core` semantics. Is
      `nextYahrzeit` right for: Adar in a leap year (should be Adar II), Adar II in
      a non-leap year, 30 Cheshvan and 30 Kislev in a short year, and a yahrzeit
      falling in the current Hebrew year but already past?
- [ ] The "died after sunset counts as the next Hebrew day" rule is **not**
      implemented. How should we capture that at data-entry time without asking
      four non-technical staff a confusing question?
- [ ] Are birthday and anniversary Hebrew conversions using the same assumptions
      as yahrzeits? Should they?

## 4. Security

- [ ] All-authenticated-can-do-everything RLS with four trusted staff: defensible,
      or should we implement real `has_role()` policies now? If so, sketch the
      minimum viable policy set (who may delete donations? who may purge the audit
      log? what should the VA actually be able to write?).
- [ ] `anon` has table-level grants on every table while every policy is
      `TO authenticated`. Confirm nothing is reachable anonymously today, then
      tell us whether to tighten the grants.
- [ ] `integration_credentials` stores API keys in plaintext JSONB. What is the
      right fix on Supabase — Vault, pgsodium envelope encryption, or keeping keys
      out of the database entirely as deploy-time secrets?
- [ ] `purge_old_audit_log()` can be called by any signed-in user and destroys two
      months of history. Confirm and propose the gating.
- [ ] Verify public sign-up is actually disabled at the Auth provider level, not
      just absent from the UI.
- [ ] Anything in the four `supabaseAdmin as any` call sites in
      `src/lib/integrations.functions.ts` that could be abused by a signed-in
      non-admin?

## 5. Performance at 10,000+ contacts

- [ ] Every list screen fetches the whole table via `fetchAll()` and filters in
      the browser. At what row count does this actually break on a mid-range phone
      on cellular? Measure rather than estimate if you can.
- [ ] `search_people` UNIONs a dozen sources and applies per-row Levenshtein.
      Profile it at 10k people with 50k donations. Is a `tsvector` column or a
      materialized search table the right move, and what would it cost us in
      freshness?
- [ ] The Tasks screen loads five tables and derives reminders client-side. Should
      reminder derivation move into the database (a view, or a nightly job writing
      real task rows)?
- [ ] Review the indexes in `schema.sql`. What is missing for the queries actually
      issued? What is redundant?
- [ ] A person's timeline loads their entire history with no limit. Recommend a
      pagination approach that keeps the "one unified feed" requirement intact.

## 6. Architecture and maintainability

- [ ] Business logic is split across Postgres functions, `src/lib/*`, and route
      components. Is the split defensible, and is anything in the wrong layer?
- [ ] Giving totals and display names are each derived in two places (database
      trigger + client). Which one should win?
- [ ] `people.$personId.tsx` (~890 lines) and `inbox.index.tsx` (~980 lines): how
      would you decompose them, and is it worth doing before or after the
      Salesforce import?
- [ ] There are **no tests at all**. Given a fixed small budget, where do the
      first tests go? Our guess is `lib/hebrew.ts`, `lib/import-mapping.ts` and
      `merge_people`.
- [ ] Is anything in the codebase incompatible with the edge/Workers runtime that
      only shows up in a production build?
- [ ] Which of the shipped dependencies are genuinely unused and safe to remove?

## 7. Mobile and usability (staff add records on phones at events)

- [ ] Walk the Add Person → log a donation → complete a task flow on a real phone.
      Where does it break down?
- [ ] Accessibility pass: contrast (gold `#F9C348` on white is suspect), focus
      order, screen-reader labels on the icon-only controls.
- [ ] Offline: records added with poor signal currently just fail. Is a queue/retry
      worth building for four users?
- [ ] Is the review/merge screen usable by a non-technical VA without training?
      That is the stated bar for every screen in this app.

## 8. Product gaps — tell us what to build first

Given a nonprofit with four non-technical staff and no in-house developer, rank
these by value per unit of effort:

- [ ] Annual tax/giving statements and donation receipts (currently nothing —
      staff asked for "the most seamless way")
- [ ] Grant deadlines auto-creating tasks (specified, not built)
- [ ] Bringing back Campaigns UI (table and links exist, screens were removed)
- [ ] Real Donorbox/Stripe donation sync (credentials stored, no sync)
- [ ] Constant Contact two-way sync with Constant Contact authoritative for
      unsubscribe/consent
- [ ] Engagement reminders as persisted, assignable tasks rather than derived
      suggestions
- [ ] Server-side pagination and search
- [ ] Role-based permissions

## 9. Deliverable we would like back

1. A findings list separated into **must fix before the Salesforce import**,
   **must fix before 10,000 contacts**, and **nice to have**.
2. Confirmation or refutation of each specific bug we flagged in
   `known-issues.md` — we would rather be told we were wrong than agreed with.
3. Anything materially broken that is **not** in `known-issues.md`. That list is
   our own assessment and is certainly incomplete.
