// lib/memberDb.ts
// 会員DB (PostgreSQL / wf_member_app_prod) への接続を一元化するモジュール。
//
// 接続経路は環境変数 DB_PROXY_FUNCTION_NAME の有無で切り替わる:
//   - 設定あり: VPC 内の「db-proxy」Lambda を invoke して問い合わせる。
//               外部 DB からは NAT Gateway の Elastic IP (固定 IP) で見える。
//               → DB 側の IP allowlist にはこの EIP を 1 つ登録すればよい。
//   - 設定なし: 従来どおり pg Pool で直結する (ローカル開発 / 移行前の互換)。
//
// これにより、プロキシが未構築でもアプリは壊れず、環境変数を入れるだけで
// 段階的に固定 IP 経由へ切り替えられる。
import { Pool } from "pg";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

export type Row = Record<string, any>;
export interface QueryResult<T extends Row = Row> {
  rows: T[];
  rowCount: number;
}

const PROXY_FN = process.env.DB_PROXY_FUNCTION_NAME;
const PROXY_REGION =
  process.env.DB_PROXY_REGION || process.env.AWS_REGION || "ap-northeast-1";

// TODO(security): PG_DATABASE_URL を全環境で設定したら、この直書きフォールバックは削除する。
//                 現状 Amplify 本番はこのフォールバックに依存しているため、いきなり消すと接続不能になる。
const PG_CONNECTION =
  process.env.PG_DATABASE_URL ||
  "postgres://wf_member_app_prod:UA5JAaqYeyVGUpD@188.93.146.126:5432/wf_member_app_prod";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: PG_CONNECTION,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

let lambda: LambdaClient | null = null;
function getLambda(): LambdaClient {
  if (!lambda) lambda = new LambdaClient({ region: PROXY_REGION });
  return lambda;
}

/**
 * 会員DB に対してパラメータ化クエリを実行する。pg の `pool.query(text, params)` と
 * 同じ呼び出し形・戻り値 ({ rows, rowCount }) を保つので、呼び出し側は経路を意識しない。
 */
export async function query<T extends Row = Row>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  if (PROXY_FN) {
    const res = await getLambda().send(
      new InvokeCommand({
        FunctionName: PROXY_FN,
        Payload: Buffer.from(JSON.stringify({ text, params })),
      })
    );

    const raw = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";

    // Lambda 実行自体の失敗 (未処理例外など)
    if (res.FunctionError) {
      throw new Error(`db-proxy invocation failed (${res.FunctionError}): ${raw}`);
    }

    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`db-proxy returned non-JSON payload: ${raw}`);
    }
    if (!payload.ok) {
      throw new Error(`db-proxy error: ${payload.error ?? "unknown"}`);
    }
    return { rows: (payload.rows ?? []) as T[], rowCount: payload.rowCount ?? 0 };
  }

  const r = await getPool().query(text, params);
  return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
}
