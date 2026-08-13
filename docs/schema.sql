-- Mitzvah House CRM — full public schema export
-- Generated 2026-08-13 00:43 UTC from the live database catalogs.
-- Recreates: extensions, enums, tables, constraints, indexes, grants, RLS policies, functions, triggers, views.

-- ============ EXTENSIONS ============
-- EXPORT ERROR for query: select 'CREATE EXTENSION IF NOT EXISTS "'||extname||'";' from pg_extension where extname not in ('plpgsql')
psql: error: connection to server at "aws-0-us-west-2.pooler.supabase.com" (54.70.143.232), port 6543 failed: FATAL:  (EINVALIDUSERINFO) Authentication error, reason: "Invalid format for user or db_name"

-- ============ ENUM TYPES ============
-- EXPORT ERROR for query: select 'CREATE TYPE public.'||t.typname||' AS ENUM ('||string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)||');'
   from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname
psql: error: missing "=" after "select" in connection info string

-- ============ TABLES ============
-- EXPORT ERROR for query: with cols as (
     select c.relname tbl, a.attnum,
            '  '||quote_ident(a.attname)||' '||format_type(a.atttypid,a.atttypmod)
            ||coalesce(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'')
            ||case when a.attnotnull then ' NOT NULL' else '' end line
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
       left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
      where n.nspname='public' and c.relkind='r')
   select 'CREATE TABLE public.'||quote_ident(tbl)||' ('||chr(10)||string_agg(line, ','||chr(10) order by attnum)||chr(10)||');'||chr(10)
     from cols group by tbl order by tbl
psql: error: missing "=" after "with" in connection info string

-- ============ PRIMARY KEYS / UNIQUE / CHECK / FOREIGN KEYS ============
-- EXPORT ERROR for query: select 'ALTER TABLE public.'||quote_ident(c.relname)||' ADD CONSTRAINT '||quote_ident(con.conname)||' '||pg_get_constraintdef(con.oid)||';'
     from pg_constraint con join pg_class c on c.oid=con.conrelid
    where con.connamespace='public'::regnamespace and con.contype in ('p','u','c','f')
    order by case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end, c.relname, con.conname
psql: error: missing "=" after "select" in connection info string

-- ============ INDEXES (excluding those backing constraints) ============
-- EXPORT ERROR for query: select indexdef||';' from pg_indexes i
    where schemaname='public'
      and not exists (select 1 from pg_constraint con
                       where con.conname=i.indexname and con.connamespace='public'::regnamespace)
    order by tablename, indexname
psql: error: missing "=" after "select" in connection info string

-- ============ DATA API GRANTS ============
-- EXPORT ERROR for query: select 'GRANT '||string_agg(distinct privilege_type, ', ')||' ON public.'||quote_ident(table_name)||' TO '||grantee||';'
     from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated','service_role')
    group by table_name, grantee order by table_name, grantee
psql: error: missing "=" after "select" in connection info string

-- ============ ROW LEVEL SECURITY ============
-- EXPORT ERROR for query: select 'ALTER TABLE public.'||quote_ident(c.relname)||' ENABLE ROW LEVEL SECURITY;'
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity order by c.relname
psql: error: missing "=" after "select" in connection info string

-- EXPORT ERROR for query: select 'CREATE POLICY '||quote_literal(policyname)||' ON public.'||quote_ident(tablename)
        ||' AS '||permissive||' FOR '||cmd
        ||' TO '||array_to_string(roles,', ')
        ||coalesce(' USING ('||qual||')','')
        ||coalesce(' WITH CHECK ('||with_check||')','')||';'
     from pg_policies where schemaname='public' order by tablename, policyname
psql: error: missing "=" after "select" in connection info string

-- ============ FUNCTIONS (project-owned; extension functions omitted) ============
-- EXPORT ERROR for query: select pg_get_functiondef(p.oid)||';'||chr(10)
     from pg_proc p
    where p.pronamespace='public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
    order by p.proname
psql: error: missing "=" after "select" in connection info string

-- ============ TRIGGERS ============
