// lib/snowflake.ts
//
// Snowflake(OPENFLOW_DB.MART の集計DM)への読み取り専用接続。BIダッシュボード用。
// 認証 = 鍵ペア(JWT)。専用サービスユーザー KB_BI_USER / ロール KB_BI_ROLE(MART SELECTのみ)。
//
// ★ネットワーク: Snowflakeはネットワークポリシーで接続元IP制限。KB_BI_USERは NETWORK_POLICY=KB_BI_POLICY。
//   接続元(dev環境/Amplify egress)のIPを許可rule OPENFLOW_DB.MART.KB_BI_ALLOWED_IPS に追加しておくこと。
//   Amplify(SSR/WEB_COMPUTE)のegressは動的なので、本番はVPC+NAT(固定EIP)経由にして そのEIPを許可する。
//
// 必要な環境変数:
//   SNOWFLAKE_BI_ACCOUNT   (既定 yamauchi-nu34583)
//   SNOWFLAKE_BI_USER      (既定 KB_BI_USER)
//   SNOWFLAKE_BI_ROLE      (既定 KB_BI_ROLE)
//   SNOWFLAKE_BI_WAREHOUSE (既定 OPENFLOW_WH)
//   SNOWFLAKE_BI_PRIVATE_KEY       … 秘密鍵(PKCS8 PEM)本文。改行は \n でも実改行でも可。本番はSecrets/Amplify環境変数で注入。
//   SNOWFLAKE_BI_PRIVATE_KEY_PATH  … 上が無い場合のフォールバック(dev用, 鍵ファイルパス)。
import snowflake from "snowflake-sdk";
import { readFileSync } from "node:fs";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

snowflake.configure({ logLevel: "ERROR" });

// 接続モード: "lambda"=VPC内Lambda(knowbie-snowflake-query)経由(本番Amplis推奨/固定egress),
//            "direct"=このプロセスから直結(dev, 接続元IPをKB_BI_POLICYで許可済のとき)。
//   本番Amplifyはegress固定IP不可のため SNOWFLAKE_BI_MODE=lambda を設定する。
const MODE = (process.env.SNOWFLAKE_BI_MODE || "direct").toLowerCase();
const QUERY_FN = process.env.SNOWFLAKE_BI_LAMBDA_FN || "knowbie-snowflake-query";
const AWS_REGION = process.env.SNOWFLAKE_BI_LAMBDA_REGION || process.env.AWS_REGION || "us-east-1";

const ACCOUNT = process.env.SNOWFLAKE_BI_ACCOUNT || "yamauchi-nu34583";
const USER = process.env.SNOWFLAKE_BI_USER || "KB_BI_USER";
const ROLE = process.env.SNOWFLAKE_BI_ROLE || "KB_BI_ROLE";
const WAREHOUSE = process.env.SNOWFLAKE_BI_WAREHOUSE || "OPENFLOW_WH";
const DATABASE = "OPENFLOW_DB";
const SCHEMA = "MART";

function privateKeyPem(): string {
  const raw = process.env.SNOWFLAKE_BI_PRIVATE_KEY;
  if (raw && raw.trim()) return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  const path = process.env.SNOWFLAKE_BI_PRIVATE_KEY_PATH;
  if (path) return readFileSync(path, "utf8");
  throw new Error("SNOWFLAKE_BI_PRIVATE_KEY か SNOWFLAKE_BI_PRIVATE_KEY_PATH を設定してください");
}

let cached: snowflake.Connection | null = null;

async function getConnection(): Promise<snowflake.Connection> {
  if (cached) {
    // 生きている接続は再利用(サーバーレスの再利用インスタンスで有効)
    const alive = await new Promise<boolean>((resolve) => {
      try {
        cached!.isValidAsync().then(resolve).catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });
    if (alive) return cached;
    cached = null;
  }
  const conn = snowflake.createConnection({
    account: ACCOUNT,
    username: USER,
    role: ROLE,
    warehouse: WAREHOUSE,
    database: DATABASE,
    schema: SCHEMA,
    authenticator: "SNOWFLAKE_JWT",
    privateKey: privateKeyPem(),
    clientSessionKeepAlive: true,
  });
  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
  cached = conn;
  return conn;
}

let lambdaClient: LambdaClient | null = null;

async function sfQueryViaLambda<T>(sqlText: string, binds: (string | number | null)[]): Promise<T[]> {
  if (!lambdaClient) lambdaClient = new LambdaClient({ region: AWS_REGION });
  const res = await lambdaClient.send(new InvokeCommand({
    FunctionName: QUERY_FN,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({ sqlText, binds })),
  }));
  const j = JSON.parse(Buffer.from(res.Payload || new Uint8Array()).toString("utf8") || "{}");
  if (!j.ok) throw new Error(j.error || "knowbie-snowflake-query failed");
  return (j.rows || []) as T[];
}

async function sfQueryDirect<T>(sqlText: string, binds: (string | number | null)[]): Promise<T[]> {
  const conn = await getConnection();
  return new Promise<T[]>((resolve, reject) => {
    conn.execute({
      sqlText,
      binds: binds as any,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows || []) as T[])),
    });
  });
}

/**
 * パラメータ化SELECTを実行し行配列を返す。プレースホルダは `?`(順序バインド)。
 * 読み取り専用ロールのため更新系は権限で弾かれる。
 * SNOWFLAKE_BI_MODE=lambda ならVPC内Lambda経由(本番)、既定は直結(dev)。呼び出し側は同一。
 */
export async function sfQuery<T = Record<string, any>>(
  sqlText: string,
  binds: (string | number | null)[] = []
): Promise<T[]> {
  return MODE === "lambda"
    ? sfQueryViaLambda<T>(sqlText, binds)
    : sfQueryDirect<T>(sqlText, binds);
}
