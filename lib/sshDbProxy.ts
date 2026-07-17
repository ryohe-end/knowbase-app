// lib/sshDbProxy.ts
// 踏み台(bastion)経由の private RDS へ SSHトンネルで読み取りクエリを行う
// knowbie-ssh-db-proxy Lambda を invoke するSSR側ヘルパー。
// 各 target は proxy 側の SSHDB_TARGETS(Secrets Manager) にマップ済み。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.SSH_DB_PROXY_FUNCTION || "knowbie-ssh-db-proxy";
const lambda = new LambdaClient({ region: REGION });

export type SshQueryResult<T = any> =
  | { ok: true; rows: T[]; rowCount: number }
  | { ok: false; error: string };

// 複数クエリを1トンネルで実行 (踏み台SSHを1本で済ませる)。
export async function sshBatch(
  target: string, queries: { text: string; params?: any[] }[]
): Promise<{ ok: true; results: { rows: any[]; rowCount: number }[] } | { ok: false; error: string }> {
  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: FN, InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ target, queries })),
    }));
    const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
    const j = JSON.parse(payload);
    if (res.FunctionError) return { ok: false, error: j?.errorMessage || "ssh-db-proxy error" };
    return j;
  } catch (e: any) {
    return { ok: false, error: e?.message || "DB接続に失敗しました" };
  }
}

// パラメータ化クエリ ($1,$2,...)。target は接続先 (例: "onetimepass")。
export async function sshQuery<T = any>(
  target: string, text: string, params: any[] = []
): Promise<SshQueryResult<T>> {
  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ target, text, params })),
    }));
    const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
    const j = JSON.parse(payload);
    if (res.FunctionError) return { ok: false, error: j?.errorMessage || "ssh-db-proxy error" };
    return j;
  } catch (e: any) {
    return { ok: false, error: e?.message || "DB接続に失敗しました" };
  }
}
