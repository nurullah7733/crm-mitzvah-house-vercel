ALTER FUNCTION public.search_people(text, integer) SECURITY INVOKER;
ALTER FUNCTION public.find_duplicate_people() SECURITY INVOKER;
ALTER FUNCTION public.tag_program_counts() SECURITY INVOKER;
ALTER FUNCTION public.lapsed_donors(text, numeric, integer, integer) SECURITY INVOKER;