-- Read-only verification after applying 0005. Returns no user rows or tokens.
select json_build_object(
  'tables', (select json_agg(json_build_object('table', tablename, 'rls', rowsecurity) order by tablename) from pg_tables where schemaname = 'public'),
  'token_policy_count', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'extension_tokens'),
  'impl_anon_execute', has_function_privilege('anon', 'public.save_item_impl(uuid,text,text,text)', 'EXECUTE'),
  'impl_authenticated_execute', has_function_privilege('authenticated', 'public.save_item_impl(uuid,text,text,text)', 'EXECUTE'),
  'impl_service_execute', has_function_privilege('service_role', 'public.save_item_impl(uuid,text,text,text)', 'EXECUTE'),
  'wrapper_authenticated_execute', has_function_privilege('authenticated', 'public.save_item(text,text,text)', 'EXECUTE'),
  'wrapper_security_definer', (select prosecdef from pg_proc where oid = 'public.save_item(text,text,text)'::regprocedure),
  'session_read_hash', has_column_privilege('authenticated', 'public.extension_tokens', 'token_hash', 'SELECT'),
  'session_revoke', has_column_privilege('authenticated', 'public.extension_tokens', 'revoked_at', 'UPDATE'),
  'session_change_owner', has_column_privilege('authenticated', 'public.extension_tokens', 'user_id', 'UPDATE'),
  'session_delete_token', has_table_privilege('authenticated', 'public.extension_tokens', 'DELETE')
) as slice6_verification;
