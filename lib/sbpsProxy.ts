// lib/sbpsProxy.ts
// SBPSはIP許可制(送信元 34.199.173.5)のため、Amplify SSRから直接ではなく
// 固定egressの knowbie-sbps-proxy Lambda 経由でHTTPS POSTする。秘密は保持せず呼び出し時に渡す。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.SBPS_PROXY_FUNCTION || "knowbie-sbps-proxy";
const lambda = new LambdaClient({ region: REGION });

export type SbpsProxyResult =
  | { ok: true; statusCode: number; body: Buffer }
  | { ok: false; error: string };

// Shift_JIS等のバイト列(body)をそのまま中継POSTし、レスポンスを Buffer で返す。
export async function sbpsProxyPost(
  endpoint: string, body: Uint8Array, basicAuth: string, contentType?: string
): Promise<SbpsProxyResult> {
  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({
        endpoint,
        bodyBase64: Buffer.from(body).toString("base64"),
        basicAuth,
        contentType,
      })),
    }));
    const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
    const j = JSON.parse(payload);
    if (res.FunctionError) return { ok: false, error: j?.errorMessage || "sbps-proxy error" };
    if (!j?.ok) return { ok: false, error: j?.error || "sbps-proxy failed" };
    return { ok: true, statusCode: j.statusCode, body: Buffer.from(j.bodyBase64 || "", "base64") };
  } catch (e: any) {
    return { ok: false, error: e?.message || "SBPS呼び出しに失敗しました" };
  }
}
