import "server-only";

import type { QueryResult, QueryResultRow } from "pg";

export type GrantViolation = { object_name: string; grantee: string; violation: string };

type Query = <T extends QueryResultRow>(text: string) => Promise<QueryResult<T>>;

// Postgres grants EXECUTE on new functions to PUBLIC by default, and that
// shipped live in Week 4. These queries are the whole of the grants check, so
// the check and its own test run exactly the same SQL.
const CHECKS = [
  `select p.oid::regprocedure::text as object_name,
          coalesce(grantee.rolname, 'PUBLIC') as grantee,
          'function_execute' as violation
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     left join pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname = 'support_agent'
      and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))`,
  `select 'default privileges for ' || owner_role.rolname as object_name,
          coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
          'default_' || lower(acl.privilege_type) as violation
     from pg_default_acl d
     join pg_roles owner_role on owner_role.oid = d.defaclrole
     left join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) acl
     left join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where (n.nspname = 'support_agent' or d.defaclnamespace = 0)
      and ((d.defaclobjtype = 'f' and acl.privilege_type = 'EXECUTE' and (acl.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated')))
        or (n.nspname = 'support_agent' and d.defaclobjtype = 'r' and grantee_role.rolname in ('anon', 'authenticated')))`,
  `select schemaname || '.' || tablename as object_name, 'n/a' as grantee, 'rls_disabled' as violation
     from pg_tables
    where schemaname = 'support_agent' and not rowsecurity`,
  `select table_schema || '.' || table_name as object_name, grantee, 'table_' || lower(privilege_type) as violation
     from information_schema.role_table_grants
    where table_schema = 'support_agent' and grantee in ('PUBLIC', 'anon', 'authenticated')`,
  `select 'schema support_agent' as object_name, r.rolname as grantee, 'schema_usage' as violation
     from pg_roles r
    where r.rolname in ('anon', 'authenticated') and has_schema_privilege(r.oid, 'support_agent', 'USAGE')`,
];

export async function findGrantViolations(query: Query): Promise<GrantViolation[]> {
  // One at a time: the query may be a single pg client, which runs one query at once.
  const violations: GrantViolation[] = [];
  for (const sql of CHECKS) violations.push(...(await query<GrantViolation>(sql)).rows);
  return violations;
}

export async function countSchemaTables(query: Query): Promise<number> {
  const result = await query<{ count: string }>(`select count(*)::text as count from pg_tables where schemaname = 'support_agent'`);
  return Number(result.rows[0]?.count ?? 0);
}
