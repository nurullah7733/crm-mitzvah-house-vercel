# Backend tests

`backend.test.ts` exercises the database rules that no amount of front-end
testing can prove: `merge_people`, `recalc_person_totals`, the duplicate-gift
fingerprint trigger, and the thank-you timeline reversal.

They are **skipped unless** these two environment variables are set:

```
TEST_SUPABASE_URL=...            # the backend to test against
TEST_SUPABASE_ACCESS_TOKEN=...   # a signed-in staff access token
TEST_SUPABASE_PUBLISHABLE_KEY=...# optional, defaults to VITE_SUPABASE_PUBLISHABLE_KEY
```

Point them at a scratch/copy backend, never at the live donor database: the
tests create and then remove contacts, gifts, events and tasks.
