# Repair import deduplication, event linking, undo, and review matching

## What will change

1. **Stop duplicate imported donations**
   - Add a stable import fingerprint for each donation row, based on the donor identity plus gift date, amount, and campaign/source details.
   - Enforce uniqueness in the database so the same gift cannot be inserted again even if an earlier bad import created a second contact for the donor.
   - Keep the existing in-memory batch registry, but make duplicate rows go to review instead of creating contacts or gifts.

2. **Make event attendance and undo fully traceable**
   - Use the existing forgiving event-name matcher when linking imported rows to events.
   - Tag every imported registration with its import batch.
   - Ensure event attendance is inserted once and its generated timeline item is removed when the registration is undone.

3. **Make import undo remove the whole batch**
   - Replace the undo function with a version that removes all batch-tagged gifts, attendance, tasks, timeline entries, contact methods, review items, contacts, and now-empty imported households in dependency-safe order.
   - Clean up the 31 review rows currently attached to a reverted batch.
   - Keep pre-existing people and households; only data created by or traceably added by the selected import is removed.

4. **Improve duplicate review matching**
   - Add a searchable contact picker so staff can choose a different existing person when the automatic suggestion is wrong or missing.
   - Use that selected contact in both individual review and shared-address review actions.
   - Preserve the existing field-by-field comparison and conflict choices.

5. **Verify**
   - Confirm database uniqueness and reverted-batch cleanup with direct queries.
   - Exercise import review, event linking, and undo behavior in the running app.
   - Confirm select-all remains available on People, Households, Events, Donations, Tasks, and Grants.

## Technical details

- Schema changes will be additive and applied through a database migration.
- Existing legitimate manual gifts are not retroactively deleted; the new fingerprint applies to imported gifts.
- No unrelated screens or existing workflows will be restructured.
