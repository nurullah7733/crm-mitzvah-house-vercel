DELETE FROM public.interactions
WHERE source_kind IS NULL
  AND (text ILIKE 'Thank-you letter sent%' OR text ILIKE 'Tax receipt sent%');

SELECT public.recalc_all_totals_internal();