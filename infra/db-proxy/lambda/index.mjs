// db-proxy Lambda
// VPC のプライベートサブネットで動き、egress は NAT Gateway (固定 EIP) を通る。
// 呼び出し側 (Amplify SSR / lib/memberDb.ts) から { text, params, target } を受け取り、
// 指定 target の PostgreSQL にパラメータ化クエリを投げて結果を返すだけの薄い RPC。
//
// 複数DB対応 (named target):
//   DB_TARGETS … {"member":"<secretArn>","newdb":"<secretArn>"} の JSON。
//                target ごとに別シークレット=別DBへ接続する。
//   PG_SECRET_ID … 後方互換。DB_TARGETS が無い場合の "member" 用シークレット。
//   接続情報はいずれも Secrets Manager から取得し、平文を env/コードに残さない。
//
// セキュリティ注意:
//   本 Lambda は「渡された SQL をそのまま実行」する汎用プロキシ。呼び出せるのは
//   IAM (lambda:InvokeFunction) を持つ主体のみ = 自社 SSR ロールに限定すること。
import { Pool } from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const DEFAULT_TARGET = "member";

// target -> secretId のマップを env から一度だけ組み立てる。
function loadTargetMap() {
  if (process.env.DB_TARGETS) {
    try {
      return JSON.parse(process.env.DB_TARGETS);
    } catch {
      throw new Error("DB_TARGETS is not valid JSON");
    }
  }
  if (process.env.PG_SECRET_ID) {
    return { [DEFAULT_TARGET]: process.env.PG_SECRET_ID };
  }
  return {};
}

const TARGET_SECRETS = loadTargetMap();
const sm = new SecretsManagerClient({});
const poolPromises = {}; // target -> Promise<Pool>

async function resolveConnectionString(secretId) {
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

function getPool(target) {
  const secretId = TARGET_SECRETS[target];
  if (!secretId) {
    throw new Error(`unknown target "${target}" (configured: ${Object.keys(TARGET_SECRETS).join(", ") || "none"})`);
  }
  // シークレット取得は非同期なので Pool 生成も遅延・キャッシュする (target ごと)。
  if (!poolPromises[target]) {
    poolPromises[target] = resolveConnectionString(secretId)
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
        poolPromises[target] = null; // 失敗はキャッシュしない
        throw e;
      });
  }
  return poolPromises[target];
}

export const handler = async (event) => {
  const text = event?.text;
  const params = Array.isArray(event?.params) ? event.params : [];
  const target = event?.target || DEFAULT_TARGET;

  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "text (SQL) is required" };
  }

  try {
    const pool = await getPool(target);
    const r = await pool.query(text, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    console.error(`[db-proxy] query error (target=${target}):`, e);
    return { ok: false, error: String(e?.message || e) };
  }
};
