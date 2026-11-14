import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID as id } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const db = new PGlite();
const a = id(),
  b = id(),
  alice = id(),
  bob = id(),
  ra = id(),
  rb = id();
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;",
  );
  await db.exec(
    readFileSync("supabase/migrations/202611140001_isolation.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/migrations/202611140002_whatsapp_auth.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140003_inbox_memory.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140004_controls.sql", "utf8"));
  await db.exec("create function public.notify_workspace_change() returns trigger language plpgsql as $$ begin return null; end $$;");
  await db.exec(readFileSync("supabase/migrations/202611140007_calendar.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140008_owner_availability.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140009_status_portal.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140010_connection_recovery.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140011_handoff_unread.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202611140012_production.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.query(
    "insert into organizations(id,name) values($1,'Revive'),($2,'Zorro')",
    [a, b],
  );
  await db.query(
    "insert into organization_members values($1,$2,'owner'),($3,$4,'staff')",
    [a, alice, b, bob],
  );
  await db.query(
    'insert into knowledge_revisions(id,organization_id,content,created_by) values($1,$2,\'{"clinic":"Revive"}\',$3),($4,$5,\'{"clinic":"Zorro"}\',$6)',
    [ra, a, alice, rb, b, bob],
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
async function asUser(user: string, fn: () => Promise<void>) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    await db.exec("set local role authenticated");
    await fn();
  } finally {
    await db.exec("rollback");
  }
}
describe("real PostgreSQL policies and constraints (PGlite)", () => {
  it("browser roles cannot read encrypted WhatsApp credentials, even for their own clinic", async () => {
    await asUser(alice, async () => { await expect(db.query("select * from whatsapp_auth where organization_id=$1", [a])).rejects.toThrow(/permission denied/i); });
  });
  it("rejects credentials attached to an account in another clinic", async () => {
    const account = id();
    await db.query("insert into whatsapp_accounts(id,organization_id) values($1,$2)", [account,a]);
    await expect(db.query("insert into whatsapp_auth values($1,$2,'creds','encrypted')", [b,account])).rejects.toThrow();
  });
  it("dashboard switching to forged tenant returns no knowledge", async () =>
    asUser(alice, async () => {
      const r = await db.query(
        "select * from knowledge_revisions where organization_id=$1",
        [b],
      );
      expect(r.rows).toEqual([]);
      const all = await db.query("select * from knowledge_revisions");
      expect(all.rows).toHaveLength(1);
      expect(JSON.stringify(all.rows)).toContain("Revive");
      expect(JSON.stringify(all.rows)).not.toContain("Zorro");
    }));
  it("Zorro staff cannot modify Revive knowledge or publish", async () =>
    asUser(bob, async () => {
      await expect(
        db.query(
          "insert into knowledge_revisions(organization_id,content,created_by) values($1,'{}',$2)",
          [a, bob],
        ),
      ).rejects.toThrow(/permission denied/);
    }));
  it("only members pass membership and only owners pass approval checks", async () =>
    asUser(bob, async () => {
      const r = await db.query<{
        own: boolean;
        foreign: boolean;
        publish: boolean;
      }>(
        "select is_member($1) as own,is_member($2) as foreign,is_member($1,true) as publish",
        [b, a],
      );
      expect(r.rows[0]).toEqual({ own: true, foreign: false, publish: false });
    }));
  it("cross-tenant publication rejected even with elevated database access", async () => {
    await expect(
      db.query(
        "insert into knowledge_publications(organization_id,revision_id,published_by) values($1,$2,$3)",
        [a, rb, alice],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("drafts never appear in the published knowledge query", async () => {
    const r = await db.query(
      "select r.* from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=$1",
      [a],
    );
    expect(r.rows).toEqual([]);
  });
  it("published revisions are immutable", async () => {
    await expect(
      db.query("update knowledge_revisions set content='{}' where id=$1", [ra]),
    ).rejects.toThrow(/immutable/);
  });
  it("same customer identifier remains separate across tenants", async () => {
    await db.query(
      "insert into contacts(organization_id,identity) values($1,'123@lid'),($2,'123@lid')",
      [a, b],
    );
    const r = await db.query("select * from contacts where identity=$1", [
      "123@lid",
    ]);
    expect(r.rows).toHaveLength(2);
  });
  it("cross-tenant account/contact conversation is rejected", async () => {
    const acc = id(),
      contact = id();
    await db.query(
      "insert into whatsapp_accounts(id,organization_id) values($1,$2)",
      [acc, a],
    );
    await db.query(
      "insert into contacts(id,organization_id,identity) values($1,$2,'456@lid')",
      [contact, b],
    );
    await expect(
      db.query(
        "insert into conversations(organization_id,account_id,contact_id) values($1,$2,$3)",
        [a, acc, contact],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("server session mapping cannot be reassigned to another tenant", async () => {
    const acc = id();
    await db.query(
      "insert into whatsapp_accounts(id,organization_id) values($1,$2)",
      [acc, a],
    );
    await expect(
      db.query("update whatsapp_accounts set organization_id=$1 where id=$2", [
        b,
        acc,
      ]),
    ).rejects.toThrow(/immutable/);
  });
  it("all tenant tables enforce RLS", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
    );
    expect(r.rows.map((x) => x.relname).sort()).toEqual(
      [
        "handoff_unread_requests",
        "calendar_connections",
        "calendar_invites",
        "calendar_oauth_flows",
        "appointment_requests",
        "whatsapp_owner_activity",
        "whatsapp_owner_reads",
        "status_portal_logins",
        "status_portal_sessions",
        "organizations",
        "organization_members",
        "whatsapp_accounts",
        "whatsapp_auth",
        "whatsapp_inbox",
        "contacts",
        "conversations",
        "messages",
        "contact_memories",
        "knowledge_revisions",
        "knowledge_documents",
        "knowledge_publications",
        "audit_logs",
        "processing_events",
      ].sort(),
    );
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true);
  });
});
