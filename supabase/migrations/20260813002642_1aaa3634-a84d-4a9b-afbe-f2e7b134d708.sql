CREATE OR REPLACE FUNCTION public.log_import_review_merge(
  _item_id uuid,
  _person_id uuid,
  _existing_before jsonb,
  _incoming jsonb,
  _surviving_after jsonb,
  _choices jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, actor_email, changes)
  VALUES ('people', _person_id, 'review_merged', auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    jsonb_build_object(
      'review_item_id', _item_id,
      'existing_before', _existing_before,
      'incoming_row', _incoming,
      'surviving_after', _surviving_after,
      'field_choices', _choices
    ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_import_review_merge(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;