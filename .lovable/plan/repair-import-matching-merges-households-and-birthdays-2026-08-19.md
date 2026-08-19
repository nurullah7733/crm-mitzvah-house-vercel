# Repair import matching, merges, households, and birthdays

## What is broken

- The importer already identifies a unique same-email, same-phone, or same-name/same-address contact as `matched`, but shared-address handling overrides that result and queues the row anyway.
- The review screen’s “certain” bucket is based only on “no field conflicts,” excludes all address-grouped rows, and does not show the certain/ambiguous split consistently.
- Manual People merges use generic text comparison, so formatting-only phone differences can appear as conflicts.
- The live `merge_people` database function still compares `s.campaign` and `d.campaign`, even though that column was dropped. This is the direct cause of the People merge failure.
- Per-person household controls exist, but applying a card performs many separate writes. A mid-card failure leaves a partial result instead of committing the whole group.
- **Exact birthday drop point:** for rows sent to review, `src/routes/_authenticated/inbox.index.tsx:781` executes `continue` immediately after queueing. The value has already survived file reading, mapping, and parsing, but that line skips both the new-contact insert at line 818 and the matched-contact update at line 856. The latest clean test import proves the non-queued path now works: all 75 imported contacts received birth dates.

## Implementation

### 1. Separate certain matches from genuine review

- Add an explicit match confidence classification to the shared matching module:
  - **Certain:** one unique contact with the same normalized email, phone, or exact name plus normalized address.
  - **Ambiguous:** multiple contacts share an identifier, typo/similar-name matches, partial identity signals, or same address with different surnames.
- Normalize names, emails, phones, and address abbreviations through shared comparison helpers used by import matching, review comparison, and manual merge comparison.
- Let certain matches bypass shared-address review and update the existing contact automatically during import, while preserving gifts, attendance, notes, sources, and birthday data.
- In Data Inbox, show “X certain matches · Y need your review” and provide one bulk confirmation action for any certain matches already queued.
- Only ask about fields where both records contain genuinely different normalized values; silently keep nonblank values when the other side is blank.

### 2. Repair People merges

- Replace every live database reference to the removed donation campaign text field with `campaign_id`, including duplicate-gift comparison inside `merge_people` and any other current function/view definition found by the database audit.
- Update manual merge comparison so formatted phone/email/name/address equivalents are treated as matches.
- Add regression coverage for merging contacts with equivalent formatted details and donations linked through `campaign_id`.
- Verify a real authenticated People-list merge completes without the missing-column error.

### 3. Make household decisions atomic and per person

- Keep one card per address and give every row its own action and relationship selector: spouse, child, parent, sibling, other, or not related.
- Keep one clearly enabled Apply button after every row has a valid decision.
- Move whole-card application into one authenticated database operation so household creation/linking, per-person relationships, contact creation/merge, and queue resolution either all succeed or all roll back.
- Surface a plain-language error without clearing the selections when saving fails.

### 4. Birthday trace and regression checks

- Add an end-to-end import-unit test that follows a mapped birth date through row building and the insert/update payload for `3/14/1978`, `1978-03-14`, `14-Mar-1978`, `12/25/90`, and `2/29/1992`.
- Add coverage proving a certain matched row fills a blank stored birthday instead of being diverted by address review.
- Confirm Hebrew conversion for the stored Gregorian date using the existing `@hebcal/core` helper.

## Validation

- Run focused import, review-merge, merge, attendance, and Hebrew-date tests.
- Query the live function definitions to confirm no current object references `donations.campaign` or `s.campaign`.
- Import a fixture containing certain matches, ambiguous matches, formatting-only differences, a mixed six-person address, and birth dates; confirm the summary counts, bulk confirmation, single-card Apply, and stored values.
- Use the authenticated preview to merge two test contacts from People and confirm the operation completes and preserves linked gifts.
