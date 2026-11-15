import pg from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Resolve relative CA paths from the repository, including workspace launches.
const repositoryRoot = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../../../" : "../", import.meta.url));
const databaseOptions = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL_CA_FILE
    ? { ca: readFileSync(resolve(repositoryRoot, process.env.DATABASE_SSL_CA_FILE), "utf8"), rejectUnauthorized: true }
    : undefined,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  idleTimeoutMillis: 10000,
  query_timeout: 15000,
  statement_timeout: 12000,
};
export const pool = new pg.Pool({...databaseOptions,max:8});
// Privacy leases must not exhaust the query pool while waiting for AI/provider I/O.
export const privacyLocks = new pg.Pool({...databaseOptions,max:6,query_timeout:60000,statement_timeout:55000});
privacyLocks.on("error",()=>{ /* Active privacy leases fail closed in chat-privacy.ts. */ });
// Idle clients can emit asynchronous network errors outside a request.
pool.on("error", (error) => {
  console.error("Database connection interrupted", { code: (error as NodeJS.ErrnoException).code || "UNKNOWN" });
});
pool.on("connect", client => {
  client.on("error", () => { /* The active query rejects; keep asynchronous resets from terminating the API. */ });
});
export class Forbidden extends Error {}
export async function membership(user: string, org: string, owner = false) {
  const { rows } = await pool.query(
    "select role from organization_members where organization_id=$1 and user_id=$2",
    [org, user],
  );
  if (!rows[0] || (owner && rows[0].role !== "owner"))
    throw new Forbidden("Forbidden");
  return rows[0].role as string;
}
export async function audit(
  org: string | null,
  event: string,
  resource: string | null = null,
  actor: string | null = null,
) {
  await pool.query(
    "insert into audit_logs(organization_id,event,resource_id,actor_id) values($1,$2,$3,$4)",
    [org, event, resource, actor],
  );
}
export async function publication(org: string) {
  const { rows } = await pool.query(
    "select r.* from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=$1",
    [org],
  );
  return rows[0];
}
