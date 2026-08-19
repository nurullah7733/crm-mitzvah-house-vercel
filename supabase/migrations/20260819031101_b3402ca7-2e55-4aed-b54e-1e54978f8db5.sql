REVOKE EXECUTE ON FUNCTION public.issue_tax_statement(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_tax_statement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.issue_acknowledgment(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_document_delivery(uuid, text, text, text) FROM anon;