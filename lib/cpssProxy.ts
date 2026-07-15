// lib/cpssProxy.ts
// CPSS proxy Lambda (固定egress 34.199.173.5) を invoke するSSR側ヘルパー。
// CPSSはIP許可制のため、Amplify SSRから直接ではなくこのLambda経由で呼ぶ。
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.CPSS_PROXY_FUNCTION || "knowbie-cpss-proxy";
const lambda = new LambdaClient({ region: REGION });

export type CpssBrand = "JOYFIT" | "FIT365";
export type CpssEnvName = "stg" | "prod";

export type CpssProxyResult = { ok: true; result: any } | { ok: false; error: string; code?: string; cpssMsg?: string };

export async function cpssCall(
  brand: CpssBrand, env: CpssEnvName, action: string, args: Record<string, any> = {}
): Promise<CpssProxyResult> {
  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ brand, env, action, args })),
    }));
    const payload = res.Payload ? Buffer.from(res.Payload).toString("utf-8") : "{}";
    const j = JSON.parse(payload);
    if (res.FunctionError) return { ok: false, error: j?.errorMessage || "proxy error" };
    return j;
  } catch (e: any) {
    return { ok: false, error: e?.message || "CPSS呼び出しに失敗しました" };
  }
}

// ブランド判定: club__c.brand__c や businessType から
export function brandFor(brand?: string): CpssBrand {
  return (brand || "").toUpperCase().startsWith("JOYFIT") ? "JOYFIT" : (brand || "").toUpperCase() === "FIT365" ? "FIT365" : "JOYFIT";
}
