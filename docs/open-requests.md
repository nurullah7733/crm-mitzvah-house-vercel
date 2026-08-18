# Request log — everything asked for, and whether it is actually done

Compiled 2026-08-18 by walking the full project conversation (147 messages) and
checking each item against the current code and the live database. Status is
based on what the code does today, not on what was claimed at the time.

Legend: **Done** · **Partial** — works for the main case, with a stated gap ·
**Not done**.

Where a request arrived truncated or in a long list, the individual sub-points are
listed separately so nothing is assumed.

---

## 1. Backend and schema (early setup)

| # | Request | Status | Notes |
|---|---|---|---|
| 1.1 | Backend with auth, `connection_check` test table shown on the homepage | Done | Then removed on request. |
| 1.2 | Remove the test table and test homepage | Done | |
| 1.3 | Summarize the project Knowledge back, build nothing | Done | |
| 1.4 | Full schema: households, people, donations, events, registrations, interactions, tasks, yahrzeits, field_sources, met_source_options | Done | Plus 15 tables added later. |
| 1.5 | RLS so only authenticated users read/write | Done | Single permissive policy per table — see known-issues A1. |
| 1.6 | Email/password login page | Done | `/auth`. |
| 1.7 | Realistic sample data to test with | Done, then deliberately purged | Removed at your request before real data. |

## 2. Navigation, shell and design

| # | Request | Status | Notes |
|---|---|---|---|
| 2.1 | Clickable dashboard, all data reachable | Done | |
| 2.2 | Brand colours, Poppins/Inter, azure sidebar, mobile bottom tabs + hamburger | Done | |
| 2.3 | Blue header with white Mitzvah House logo on every page | Done | |
| 2.4 | Full-width search bar with sparkle icon at the top of every screen | Done | |
| 2.5 | 16px inputs everywhere so iOS does not zoom | Done | |
| 2.6 | Yahrzeits are not a separate tab — fold into a person's special dates | Done | |
| 2.7 | Inbox is for spreadsheet/platform uploads | Done | |
| 2.8 | Dashboard opens with "Needs attention", not nav tiles | Done | |
| 2.9 | Bottom tabs reduced to Dashboard / People / Tasks (no Inbox, no Settings) | Done | |
| 2.10 | Dashboard greets whoever is signed in | Done | |
| 2.11 | Consistent card design across People and every other screen | Done | |
| 2.12 | No separate Programs tab (programs filter inside Events) | Done | |
| 2.13 | No separate Volunteers tab (filter within People) | Done | |

## 3. People, households, events, donations, tasks

| # | Request | Status | Notes |
|---|---|---|---|
| 3.1 | "+" add buttons on People, Households, Events, Donations, Tasks; bottom sheet on mobile, modal on desktop | Done | |
| 3.2 | Add-person form with only a name required, household picker / create inline | Done | Name is optional now too, for address-only records. |
| 3.3 | Source written to `field_sources` on add | Partial | Add forms and imports write provenance; later inline edits only hit `audit_log`. |
| 3.4 | People filter chips, sort, birthday-range search, giving-amount search | Done | |
| 3.5 | Person profile: contact / giving / birthday / yahrzeit cards, unified timeline, tasks, programs | Done | |
| 3.6 | Timeline mixes everything chronologically with coloured icons | Done | No lazy loading or filter — known-issues 20/42. |
| 3.7 | Stack contact and timeline vertically on small screens | Done | |
| 3.8 | Tags editable inline with + / − everywhere, and clickable to filter | Done | |
| 3.9 | Households as a clickable grid with merged member activity | Done | |
| 3.10 | Households CSV export | Done | |
| 3.11 | Donations: calendar date range instead of a year dropdown; missing 2025 fixed | Done | |
| 3.12 | Donations page left-aligned and visually consistent | Done | |
| 3.13 | Show 3 most recent donations with "show all" | Done | |
| 3.14 | Task completion via circular checkbox + "Complete task" modal | Done | |
| 3.15 | "Show completed tasks" limited to that week, across all users | Done | |
| 3.16 | Suggested invitees open the profile instead of registering instantly | Done | |
| 3.17 | Multiple phone numbers / emails per person | Done | `contact_methods`. |
| 3.18 | Normalize capitalization of imported names and addresses | Done | |
| 3.19 | Grants and Campaigns as top-level nav after Donations | Partial | Grants shipped; Campaigns page removed at your request (3.21). |
| 3.20 | Grants usable — create funder and program officer inline, real lifecycle | Done | |
| 3.21 | Remove the Campaigns page | Done | Table and links still exist underneath — known-issues 24. |
| 3.22 | Grant deadlines auto-create tasks | Done | Verified in `CampaignGrantDialogs.tsx`. |
| 3.23 | Grant payments recorded as donations linked to the grant, counted once | Done | No award-vs-received reconciliation — known-issues 25. |
| 3.24 | Dashboard surfaces upcoming grant deadlines, then moved off the dashboard | Done | Moved as asked. |
| 3.25 | Grants / Tasks / Campaigns CSV export from their own screens | Not done | Covered only by the Settings ZIP backup. |

## 4. Hebrew calendar and lifecycle

| # | Request | Status | Notes |
|---|---|---|---|
| 4.1 | Use `@hebcal/core`, never hand-rolled calendar math | Done | |
| 4.2 | Birth date → Hebrew date on profile, live in the add form | Done | |
| 4.3 | Yahrzeit next occurrence, "in X days" | Done | |
| 4.4 | Adar yahrzeits default to Adar II in leap years | Done | |
| 4.5 | Reminders fire on the Hebrew date with the English equivalent, on the day | Done | |
| 4.6 | After-sunset death rule (Hebrew day rolls over) | Not done | Known-issues 29 — dates can be one day off. |
| 4.7 | Bar/Bat Mitzvah milestone surfaced as a task, never automatic | Done | |
| 4.8 | Age-18 milestone surfaced separately | Done | |
| 4.9 | "Become adult" prompts for mailing preference and contact info, keeps household | Done | |
| 4.10 | "Move to new household" action | Done | |

## 5. Reminders and outreach

| # | Request | Status | Notes |
|---|---|---|---|
| 5.1 | Reach-out reminder for upcoming birthdays and anniversaries | Done | Derived, not stored — known-issues 18. |
| 5.2 | Call reminder when someone gave this week | Done | Same caveat. |
| 5.3 | Follow-up a month after a large gift | Done | Same caveat. |
| 5.4 | Lapsed donor logic based on prior-year vs current-year giving, live (no 1 Jan bug) | Done | |
| 5.5 | Configurable lapsed thresholds | Done | `app_settings`. |
| 5.6 | LYBUNT / SYBUNT views with bulk follow-up actions | Done | `/renewals`. |
| 5.7 | Thank-you letter tracking on donations | Done | |
| 5.8 | Unchecking thank-you / receipt reverses every side effect | Done | Handled by database triggers. |
| 5.9 | Same reversibility audit for attendance, donations, completed tasks | Done | |
| 5.10 | Annual tax statements / receipt documents ("most seamless way for tax statements") | Not done | Only flags and CSV — known-issues 23. |

## 6. Search

| # | Request | Status | Notes |
|---|---|---|---|
| 6.1 | Natural-language questions in the top search bar | Partial | Interprets common phrasings; not a general question answerer. |
| 6.2 | Typo tolerance / fuzzy matching | Done | `search_people` with trigram + Levenshtein. Package used is Postgres-side, not `fastest-levenshtein` in the browser. |
| 6.3 | Search tags, programs, events, households, grants | Done | |
| 6.4 | Duplicate-name search for detection | Done | `find_duplicate_people`, capped at 200 pairs — known-issues 30. |

## 7. Import Center and Data Inbox

| # | Request | Status | Notes |
|---|---|---|---|
| 7.1 | Column mapping step with confirmation | Done | |
| 7.2 | Import clean rows immediately; only problem rows go to review | Done | |
| 7.3 | Finish summary "X imported · Y need review" | Done | |
| 7.4 | Resumable review queue | Done | |
| 7.5 | Undo reverses the whole batch, including rows resolved later from the queue | Done | Hard delete, so later staff edits are lost — known-issues 15. |
| 7.6 | Undo report of what was removed and what could not be | Done | |
| 7.7 | Root-cause explanation for rows surviving undo | Done | Cause: review-created records were untagged; `tasks`/`registrations` had no `import_batch_id`. Both fixed. |
| 7.8 | Session persistence so a long mapping session cannot time out and lose work | Done | |
| 7.9 | Child rows linked to a household in one CSV row | Done | |
| 7.10 | Separate billing and home address | Done | |
| 7.11 | Structured address fields (line 2/3, city, state, postal, county) | Done | |
| 7.12 | Review options: edit / merge / discard, merge pulls up the similar contact | Done | |
| 7.13 | Mandatory reason when discarding a row | Done | |
| 7.14 | Duplicates flagged must not also be created | Done | Ambiguous rows are blocked from writing. |
| 7.15 | Duplicate detection against the database **and** rows earlier in the same batch | Done | Live in-batch registry. |
| 7.16 | Guard against re-importing the same file | Done | Fingerprints on gifts; repeat rows flagged. |
| 7.17 | Duplicate donations on import stopped at the database level | Partial | Unique `import_fingerprint` index + app checks; still keyed on `person_id`, so the same gift on two mistakenly separate contacts is not caught, and manual entries have no constraint — known-issues 7. |
| 7.18 | Duplicate-donation count reported before any deletion, then totals recalculated | Done | Reported 0 duplicate groups; nothing deleted blindly. |
| 7.19 | Event column detected, matched by name, registrations created as attended, timeline entry | Partial | Works, but the importer's inline version does not upgrade an existing "Registered" row to "Attended" — known-issues 10. |
| 7.20 | Mapping preview showing "34 people will be linked to Shabbat 100" | Done | |
| 7.21 | Assign a whole import to one event even with no event column | Done | |
| 7.22 | Show the complete existing contact beside the incoming row (all phones, emails, address, household, birthday, giving, attendance, notes) | Partial | Shows the compared fields plus counts of gifts/giving/attendance/notes/tasks — not every phone, email or address on the record. |
| 7.23 | Field-by-field choice when merging, with live preview | Done | |
| 7.24 | Auto-keep any field only one side has; only ask about genuine conflicts | Done | |
| 7.25 | Search box to merge with a contact the system did not suggest | Done | Added in the current pass, in both the review list and the compare dialog. |
| 7.26 | Group everyone sharing an address on one card | Done | |
| 7.27 | Per-person decisions: same person / related + relationship / not related / not sure | Done | |
| 7.28 | Bulk "all related" and "none related" inside a group | Done | |
| 7.29 | Same-name prompt: "same person, or a junior/senior?" | Partial | Same-name rows are grouped and flagged; the question is not phrased as that explicit junior/senior choice. |
| 7.30 | Forgiving address matching (Rd vs Road, Apt 3B vs #3B) | Done | |
| 7.31 | Never auto-link on address alone | Done | Always requires confirmation. |
| 7.32 | Show the source spreadsheet row | Done | |
| 7.33 | "Merge all with no conflicts" bulk action | Done | |
| 7.34 | Undo of a one-tap merge | Done | 12-second undo toast. |
| 7.35 | Select all / clear all in the Data Inbox, plus "select all matching filter", bulk discard and dismiss with a count | Not done | The Inbox only has "Merge all with no conflicts"; the select-all bars are on the list pages, not the review queue. |
| 7.36 | Finished or undone batches moved to a collapsed "Past imports" section | Not done | Handled rows still render in the same view. |
| 7.37 | Salesforce-specific import preset and dry run | Not done | Generic CSV path only — known-issues 22. |

## 8. Bulk actions on list pages

| # | Request | Status | Notes |
|---|---|---|---|
| 8.1 | Select multiple people and delete them | Done | |
| 8.2 | Select multiple people and add to a tag / event / list | Done | |
| 8.3 | Bulk delete on Donations, Events, Households, Grants, Tasks, Campaigns | Done | Soft delete where the table supports it. |
| 8.4 | Purge the fake sample data | Done | |
| 8.5 | "Select all", including "all matching current filter", with a count and confirmation | Done on list pages | Missing in the Data Inbox — see 7.35. |
| 8.6 | Merge from the bulk bar when exactly two People or Households are selected | Done | |

## 9. Duplicates and merging

| # | Request | Status | Notes |
|---|---|---|---|
| 9.1 | Duplicate email constraint must not block merges | Done | Unique constraint dropped. |
| 9.2 | Side-by-side merge with two clearly labelled columns | Done | |
| 9.3 | All history moves to the survivor | Partial | Everything re-points, but a duplicate registration's status is discarded and households are not consolidated — known-issues 11. |
| 9.4 | Merges recorded with a full snapshot of the losing record | Done | `merge_log`. |
| 9.5 | Household merge | Done | `merge_households`. |
| 9.6 | Shared addresses flagged for household-relationship review | Done | |

## 10. Address-only households

| # | Request | Status | Notes |
|---|---|---|---|
| 10.1 | Create a household from an address alone, auto-named, renameable | Done | |
| 10.2 | Two-tap quick add on a phone | Done | |
| 10.3 | Fill the address from the phone's location | Done | |
| 10.4 | Optional partial details and free-text notes | Done | |
| 10.5 | "Address only — no contact yet" status, excluded from reporting/mailing by default | Done | |
| 10.6 | Households filter for address-only | Done | |
| 10.7 | Auto task "Find out who lives at [address]" | Done | |
| 10.8 | Prompt to link a later-added person to the existing address | Done | |
| 10.9 | Included in shared-address duplicate detection | Done | |
| 10.10 | Log visits and deliveries against an address-only household | Done | |
| 10.11 | Zero-member households must not break counts, rollups or mailing lists | Done | |

## 11. Settings, staff and administration

| # | Request | Status | Notes |
|---|---|---|---|
| 11.1 | Settings screen | Done | |
| 11.2 | Programs / tags / labels in one section; integrations in one section | Done | |
| 11.3 | Collapsible sections including Staff | Done | |
| 11.4 | Staff invites by email from inside the app, no backend dashboard | Done | |
| 11.5 | Account status Active / Invited / Disabled | Done | |
| 11.6 | Roles synced to auth metadata | Done | |
| 11.7 | "Resend invite" always available, invalidating unused invites | Done | |
| 11.8 | Deleting a staff member frees the email (hard-deletes the auth account) | Done | |
| 11.9 | Change-history retention with 2-month auto-cleanup | Done | Scheduled daily; the manual button is not admin-gated — known-issues 5. |
| 11.10 | Integrations panel actually functional | Partial | Credentials, masking, status and event log are real; no data actually syncs — known-issues 21. |
| 11.11 | Whole-database CSV export as one ZIP backup | Done | 17 tables. |

## 12. Security and integrity work

| # | Request | Status | Notes |
|---|---|---|---|
| 12.1 | Invite-only sign-up | Done | Verify the provider setting too. |
| 12.2 | Work correctly past 1,000 rows / at 3,000+ contacts | Done for correctness | Still client-side filtering — known-issues 16. |
| 12.3 | Giving totals moved into database triggers | Done | |
| 12.4 | Soft delete and audit trails | Partial | Present, but not enforced by the database — known-issues 6. |
| 12.5 | Revertible imports | Done | Hard-delete revert — known-issues 15. |
| 12.6 | Revoke `anon` grants | Done | Verified: zero `anon` table grants. |
| 12.7 | Secure the audit log | Done | Insert/update/delete blocked; reads for signed-in staff. |
| 12.8 | Keep `.env` out of GitHub | Done | Ignored; keys are platform-injected. |
| 12.9 | Fix SECURITY DEFINER linter findings | Done | Read-only functions switched to INVOKER; privileged EXECUTE revoked from anon/public. |
| 12.10 | Fix JS-YAML and SheetJS advisories | Done | |
| 12.11 | Encrypt stored integration credentials | Not done | Plaintext JSONB — known-issues 2. |
| 12.12 | Per-role permissions actually enforced for everyday CRUD | Not done | Known-issues A1. |

## 13. Documentation and handover

| # | Request | Status | Notes |
|---|---|---|---|
| 13.1 | Read-only end-to-end audit | Done | |
| 13.2 | Handover pack for third-party review | Done | `docs/`. |
| 13.3 | Export the complete schema as SQL | Done | `docs/schema.sql`, regenerated 2026-08-18 from the live database. |
| 13.4 | Keep this request log and known-issues current | Done | This file and `docs/known-issues.md`. |

---

## Where a truncated message may have hidden something

Several of your longer messages were shortened before reaching me. The items most
likely to have carried extra detail I could not see, and which are therefore worth
re-stating if they still matter:

- The very long People/Households/Events/Donations spec (message 15) — the middle
  of it was cut. Everything visible is covered above, but if it named a specific
  filter or column that is missing, tell me which.
- The search-bar prompt asked specifically for the `fastest-levenshtein` package
  with Damerau-Levenshtein distance. Fuzzy search is implemented in the database
  instead (trigram + Levenshtein). Same outcome, different mechanism — say if you
  want it done the way you specified.
- "The most seamless way for tax statements" was mentioned in passing and never
  built (7.5.10 / known-issues 23). It is the largest outstanding functional gap.
