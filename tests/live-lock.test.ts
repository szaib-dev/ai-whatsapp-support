import { expect, it } from "vitest";
// Opt-in regression against the configured Supabase database. All writes roll back.
it.skipIf(process.env.RUN_LIVE_DB_TESTS !== "1")("delivery account lock permits concurrent Signal-key persistence", async () => {
  const { config } = await import("dotenv"); config({ quiet: true });
  const { pool } = await import("../apps/api/src/db.js");
  const a = await pool.connect(), b = await pool.connect();
  try {
    const account = (await a.query("select id,organization_id from whatsapp_accounts where organization_id=$1 and authenticated_jid is not null limit 1", [process.env.LIVE_TEST_ORGANIZATION_ID])).rows[0];
    expect(account).toBeTruthy();
    for (const lock of ["update", "no key update"]) {
      await a.query("begin"); await b.query("begin");
      try {
        await a.query(`select id from whatsapp_accounts where organization_id=$1 and id=$2 for ${lock}`, [account.organization_id, account.id]);
        await b.query("set local lock_timeout='1500ms'");
        const write = b.query("insert into whatsapp_auth values($1,$2,'__lock_regression_probe__','temporary rollback-only data')", [account.organization_id, account.id]);
        if (lock === "update") await expect(write).rejects.toMatchObject({ code: "55P03" });
        else await expect(write).resolves.toMatchObject({ rowCount: 1 });
      } finally { await b.query("rollback"); await a.query("rollback"); }
    }
  } finally { a.release(); b.release(); await pool.end(); }
}, 45000);
