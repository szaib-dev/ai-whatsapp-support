import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from "@whiskeysockets/baileys";
import { pool } from "./db.js";
import { SessionCipher } from "./session-crypto.js";
export async function encryptedAuth(org: string, account: string, cipher: SessionCipher) {
  const context = (key: string) => JSON.stringify([org, account, key]);
  async function read(key: string) {
    const row = (await pool.query("select ciphertext from whatsapp_auth where organization_id=$1 and account_id=$2 and key_id=$3", [org, account, key])).rows[0];
    return row ? JSON.parse(cipher.open(context(key), row.ciphertext), BufferJSON.reviver) : null;
  }
  // Serialize writes so concurrent credential updates cannot overwrite newer state.
  let pending = Promise.resolve();
  const write = (entries: [string, unknown][]) => {
    const work = pending.then(async () => {
      const db = await pool.connect();
      try {
        await db.query("begin");
        const removed = entries.filter(([, value]) => value === null).map(([key]) => key);
        const saved = entries.filter(([, value]) => value !== null).map(([key, value]) => ({ key_id: key, ciphertext: cipher.seal(context(key), JSON.stringify(value, BufferJSON.replacer)) }));
        if (removed.length) await db.query("delete from whatsapp_auth where organization_id=$1 and account_id=$2 and key_id=any($3::text[])", [org, account, removed]);
        if (saved.length) await db.query("insert into whatsapp_auth(organization_id,account_id,key_id,ciphertext) select $1::uuid,$2::uuid,v.key_id,v.ciphertext from jsonb_to_recordset($3::jsonb) as v(key_id text,ciphertext text) on conflict(organization_id,account_id,key_id) do update set ciphertext=excluded.ciphertext", [org, account, JSON.stringify(saved)]);
        await db.query("commit");
      } catch (e) { await db.query("rollback"); throw e; }
      finally { db.release(); }
    });
    pending = work;
    return work;
  };
  const creds = await read("creds") || initAuthCreds();
  const state: AuthenticationState = { creds, keys: {
    get: async (type, ids) => {
      await pending;
      if (!ids.length) return {};
      const rows = (await pool.query("select key_id,ciphertext from whatsapp_auth where organization_id=$1 and account_id=$2 and key_id=any($3::text[])", [org, account, ids.map(id => JSON.stringify([type, id]))])).rows;
      const encrypted = new Map<string, string>(rows.map(row => [row.key_id, row.ciphertext]));
      const values: any = {};
      for (const id of ids) {
        const key = JSON.stringify([type, id]);
        const stored = encrypted.get(key);
        let value = stored ? JSON.parse(cipher.open(context(key), stored), BufferJSON.reviver) : null;
        if (value && type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.fromObject(value);
        values[id] = value;
      }
      return values;
    },
    set: async data => { await write(Object.entries(data).flatMap(([type, values]) => Object.entries(values || {}).map(([id, value]) => [JSON.stringify([type, id]), value] as [string, unknown]))); },
  }};
  return { state, save: () => write([["creds", JSON.parse(JSON.stringify(creds, BufferJSON.replacer), BufferJSON.reviver)]]), flush: () => pending };
}
