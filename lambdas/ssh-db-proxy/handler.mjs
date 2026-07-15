// knowbie-ssh-db-proxy
// 踏み台(bastion)経由でしか到達できない private RDS へ、SSHローカルフォワード + パラメータ化
// クエリを行う読み取りプロキシ。db-proxy と同じ VPC/サブネット(固定egress 34.199.173.5)で動かす。
// 踏み台SGは egress IP の 22番を許可済み、egress SG は outbound 22 を許可済みである前提。
//
// event: { target, text, params }
// SSHDB_TARGETS(env) = {"onetimepass":"<secretArn>", ...}
//   secret(JSON): { bastionHost, bastionUser, privateKey(PEM), dbHost, dbPort, dbName, dbUser, dbPassword, ssl? }
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import net from "node:net";
import ssh2 from "ssh2";
import pg from "pg";

const TARGETS = (() => { try { return JSON.parse(process.env.SSHDB_TARGETS || "{}"); } catch { return {}; } })();
const sm = new SecretsManagerClient({});
const cfgCache = {};

async function getConfig(target) {
  const arn = TARGETS[target];
  if (!arn) throw new Error(`unknown target "${target}" (configured: ${Object.keys(TARGETS).join(",") || "none"})`);
  if (!cfgCache[target]) {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
    cfgCache[target] = JSON.parse(r.SecretString || "{}");
  }
  return cfgCache[target];
}

// SSH ローカルフォワード: 127.0.0.1:<ephemeral> → bastion → RDS。pg は通常ソケットで接続する。
// queries: [{text, params}] を1接続で順次実行し、結果配列を返す(踏み台SSHを1本で済ませる)。
function tunnelExec(cfg, queries) {
  return new Promise((resolve, reject) => {
    const ssh = new ssh2.Client();
    let settled = false;
    let server = null;
    const cleanup = () => { try { server && server.close(); } catch {} try { ssh.end(); } catch {} };
    const done = (fn, arg) => { if (!settled) { settled = true; cleanup(); fn(arg); } };
    const timer = setTimeout(() => done(reject, new Error("ssh/db timeout")), 110000);

    ssh.on("ready", () => {
      server = net.createServer((sock) => {
        ssh.forwardOut("127.0.0.1", 0, cfg.dbHost, Number(cfg.dbPort), (err, ch) => {
          if (err) { sock.destroy(); return; }
          sock.pipe(ch).pipe(sock);
          sock.on("error", () => { try { ch.close(); } catch {} });
          ch.on("error", () => { try { sock.destroy(); } catch {} });
        });
      });
      server.on("error", (e) => { clearTimeout(timer); done(reject, e); });
      server.listen(0, "127.0.0.1", async () => {
        const port = server.address().port;
        const client = new pg.Client({
          host: "127.0.0.1", port,
          user: cfg.dbUser, password: cfg.dbPassword, database: cfg.dbName,
          ssl: cfg.ssl === false ? false : { rejectUnauthorized: false },
          connectionTimeoutMillis: 15000, statement_timeout: 60000,
        });
        try {
          await client.connect();
          const results = [];
          for (const q of queries) {
            const res = await client.query(q.text, Array.isArray(q.params) ? q.params : []);
            results.push({ rows: res.rows, rowCount: res.rowCount });
          }
          try { await client.end(); } catch {}
          clearTimeout(timer);
          done(resolve, results);
        } catch (e) {
          try { await client.end(); } catch {}
          clearTimeout(timer);
          done(reject, e);
        }
      });
    });
    ssh.on("error", (e) => { clearTimeout(timer); done(reject, e); });
    ssh.connect({ host: cfg.bastionHost, port: 22, username: cfg.bastionUser, privateKey: cfg.privateKey, readyTimeout: 40000 });
  });
}

export const handler = async (event) => {
  const target = event?.target || "onetimepass";
  // 単発 { text, params } または バッチ { queries: [{text,params}] }
  const batch = Array.isArray(event?.queries) ? event.queries : null;
  const queries = batch || (event?.text ? [{ text: event.text, params: event.params }] : null);
  if (!queries || queries.length === 0) return { ok: false, error: "text or queries required" };
  try {
    const cfg = await getConfig(target);
    const results = await tunnelExec(cfg, queries);
    if (batch) return { ok: true, results };
    return { ok: true, rows: results[0].rows, rowCount: results[0].rowCount };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};
