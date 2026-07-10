// db-proxy Lambda
// VPC のプライベートサブネットで動き、egress は NAT Gateway (固定 EIP) を通る。
// 呼び出し側 (Amplify SSR / lib/memberDb.ts) から { text, params } を受け取り、
// 会員DB (PostgreSQL) にパラメータ化クエリを投げて結果を返すだけの薄い RPC。
//
// 接続情報は Secrets Manager から取得する (平文を環境変数・コードに残さない):
//   - PG_SECRET_ID  … シークレット ARN or 名前。値は接続文字列そのもの、または
//                      {"connectionString":"postgres://..."} の JSON。
//   - PG_DATABASE_URL … ローカル実行用の後方互換フォールバック (通常は未設定)。
//
// セキュリティ注意:
//   本 Lambda は「渡された SQL をそのまま実行」する汎用プロキシ。呼び出せるのは
//   IAM (lambda:InvokeFunction) を持つ主体のみ = 自社 SSR ロールに限定すること。
import { Pool } from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let poolPromise = null;

async function resolveConnectionString() {
  const secretId = process.env.PG_SECRET_ID;
  if (secretId) {
    const sm = new SecretsManagerClient({});
    const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    const raw = res.SecretString ?? "";
    // 接続文字列そのもの、または {"connectionString": "..."} の両形式を許容
    if (raw.trim().startsWith("{")) {
      const obj = JSON.parse(raw);
      const cs = obj.connectionString || obj.PG_DATABASE_URL;
      if (!cs) throw new Error("secret JSON has no connectionString/PG_DATABASE_URL");
      return cs;
    }
    return raw;
  }
  if (process.env.PG_DATABASE_URL) return process.env.PG_DATABASE_URL;
  throw new Error("neither PG_SECRET_ID nor PG_DATABASE_URL is set");
}

function getPool() {
  // シークレット取得は非同期なので Pool 生成も遅延・キャッシュする。
  if (!poolPromise) {
    poolPromise = resolveConnectionString()
      .then(
        (connectionString) =>
          new Pool({
            connectionString,
            max: Number(process.env.PG_POOL_MAX || 3),
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
          })
      )
      .catch((e) => {
        // 失敗をキャッシュしない (次回リトライできるように)
        poolPromise = null;
        throw e;
      });
  }
  return poolPromise;
}

export const handler = async (event) => {
  const text = event?.text;
  const params = Array.isArray(event?.params) ? event.params : [];

  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "text (SQL) is required" };
  }

  try {
    const pool = await getPool();
    const r = await pool.query(text, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    console.error("[db-proxy] query error:", e);
    return { ok: false, error: String(e?.message || e) };
  }
};
