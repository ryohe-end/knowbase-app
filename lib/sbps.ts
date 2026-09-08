// lib/sbps.ts
// SBペイメントサービス(SBPS) API型 決済連携クライアント。
// 基本仕様: HTTPS/POST, Shift_JIS XML, TLS1.2, Basic認証必須, sps_hashcode=SHA-1。
//   ハッシュ = 「リクエストの各タグ値(hashを除く)を項目定義順に連結」+「ハッシュキー」を SHA-1。
// エンドポイント/Basic認証ID・PW/ハッシュキー は SBPS から加盟店へ個別払い出し → env で注入。
//
// 実装状況: クライアント本体(XML生成/ハッシュ/POST/レスポンス解析)は確定仕様どおり。
//   返金/取消(ST02-00303) と 部分返金(ST02-00307) の「フィールド順」は
//   加盟店へ払い出される公式 IF仕様(PDF) と要照合 (下記 REFUND_FIELD_ORDER のコメント参照)。
import crypto from "crypto";
import iconv from "iconv-lite";
import { sbpsProxyPost } from "@/lib/sbpsProxy";

export type SbpsEnv = "stg" | "prod";

export interface SbpsConfig {
  endpoint: string;      // 個別払い出しURL (例: https://xxx.sps-system.com/api/xmlapi.do)
  merchantId: string;    // 5桁
  serviceId: string;     // 3桁
  hashKey: string;       // ハッシュキー
  basicId: string;       // Basic認証 ID
  basicPass: string;     // Basic認証 PW
  // 3DES/BASE64 暗号(cipherEnabled)は 1day 返金では通常不要。将来用に保持。
  cipherEnabled?: boolean;
}

// env から stg/prod の設定を読む。値は Amplify 環境変数(暗号化) に登録する前提。
export function loadSbpsConfig(env: SbpsEnv = "stg"): SbpsConfig {
  const p = env === "prod" ? "SBPS_PROD_" : "SBPS_STG_";
  const g = (k: string) => (process.env[`${p}${k}`] || "").trim();
  // API型 接続先(非機密)。env 未設定時のフォールバック。
  const defaultEndpoint = env === "prod"
    ? "https://api.sps-system.com/api/xmlapi.do"
    : "https://stbfep.sps-system.com/api/xmlapi.do";
  const cfg: SbpsConfig = {
    endpoint: g("ENDPOINT") || defaultEndpoint,
    merchantId: g("MERCHANT_ID"),
    serviceId: g("SERVICE_ID"),
    hashKey: g("HASHKEY"),
    basicId: g("BASIC_ID"),
    basicPass: g("BASIC_PASS"),
    cipherEnabled: g("CIPHER_ENABLED") === "true",
  };
  return cfg;
}

export function isSbpsConfigured(cfg: SbpsConfig): boolean {
  return !!(cfg.endpoint && cfg.merchantId && cfg.serviceId && cfg.hashKey && cfg.basicId && cfg.basicPass);
}

// YYYYMMDDhhmmss (JST)
export function sbpsRequestDate(d: Date = new Date()): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000); // JSTへ
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}${p(j.getUTCHours())}${p(j.getUTCMinutes())}${p(j.getUTCSeconds())}`;
}

// sps_hashcode: 全フィールド値(順序どおり)を連結し末尾に hashKey を付けて SHA-1(hex小文字)。
export function sbpsHash(orderedValues: string[], hashKey: string): string {
  const joined = orderedValues.join("") + hashKey;
  // SBPS は Shift_JIS バイト列に対する SHA-1。ASCII のみなら差は出ないが、和名等に備えて SJIS で計算。
  return crypto.createHash("sha1").update(new Uint8Array(iconv.encode(joined, "Shift_JIS"))).digest("hex");
}

// 順序付きフィールド → Shift_JIS XML (sps_hashcode を末尾に自動付与)。
export function buildSbpsXml(id: string, orderedFields: Array<[string, string]>, hashKey: string): { xml: string; hashcode: string } {
  const values = orderedFields.map(([, v]) => v ?? "");
  const hashcode = sbpsHash(values, hashKey);
  const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = orderedFields.map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("");
  const xml =
    `<?xml version="1.0" encoding="Shift_JIS"?>` +
    `<sps-api-request id="${id}">${body}<sps_hashcode>${hashcode}</sps_hashcode></sps-api-request>`;
  return { xml, hashcode };
}

// レスポンス(Shift_JIS XML) を素朴にタグ辞書へ。
export function parseSbpsResponse(sjisBuf: Buffer): { res_result?: string; res_err_code?: string; raw: string; fields: Record<string, string> } {
  const raw = iconv.decode(sjisBuf, "Shift_JIS");
  const fields: Record<string, string> = {};
  for (const m of raw.matchAll(/<([a-zA-Z0-9_]+)>([^<]*)<\/\1>/g)) fields[m[1]] = m[2];
  return { res_result: fields["res_result"], res_err_code: fields["res_err_code"], raw, fields };
}

export interface SbpsPostResult {
  ok: boolean;              // HTTP+res_result=OK
  status: number;
  result?: string;          // res_result (OK/NG)
  errCode?: string;         // res_err_code
  fields: Record<string, string>;
  requestXml: string;
  rawResponse: string;
}

// 実POST。dryRun=true なら送信せず XML/ハッシュのみ返す(疎通前の検証用)。
export async function sbpsPost(
  cfg: SbpsConfig, id: string, orderedFields: Array<[string, string]>, opts?: { dryRun?: boolean }
): Promise<SbpsPostResult> {
  const { xml } = buildSbpsXml(id, orderedFields, cfg.hashKey);
  if (opts?.dryRun) {
    return { ok: true, status: 0, result: "DRYRUN", fields: {}, requestXml: xml, rawResponse: "" };
  }
  if (!isSbpsConfigured(cfg)) {
    return { ok: false, status: 0, result: "NG", errCode: "config_missing", fields: {}, requestXml: xml, rawResponse: "" };
  }
  // SBPSはIP許可制(送信元 34.199.173.5)のため、固定egressの sbps-proxy Lambda 経由で送信する。
  const bodyBuf = new Uint8Array(iconv.encode(xml, "Shift_JIS"));
  const res = await sbpsProxyPost(
    cfg.endpoint, bodyBuf, `${cfg.basicId}:${cfg.basicPass}`, "text/xml; charset=Shift_JIS"
  );
  if (!res.ok) {
    return { ok: false, status: 0, result: "NG", errCode: "proxy_error", fields: { error: res.error }, requestXml: xml, rawResponse: res.error };
  }
  const parsed = parseSbpsResponse(res.body);
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300 && parsed.res_result === "OK",
    status: res.statusCode,
    result: parsed.res_result,
    errCode: parsed.res_err_code,
    fields: parsed.fields,
    requestXml: xml,
    rawResponse: parsed.raw,
  };
}

// ============ 返金/取消 ============
// ※ フィールド順は公式 IF仕様(PDF) と要照合。
//   実データ確認の結果、1day/OneTimePass(t1pass) と FIT365(sb_history) は
//   いずれも SBPS の識別子として **tracking_id (res_tracking_id, 14桁)** のみを保持し、
//   sps_transaction_id は保存していない。よって返金は tracking_id を主キーとする。
//   cust_code/order_id は元決済の補助識別子(sb_history に存在)で、方式により必要。
//   sps_transaction_id は任意(存在すれば付与)。exact な必須項目/順序は IF仕様で確定させる。

export const SBPS_ID_REFUND_FULL = "ST02-00303-101";     // 取消・返金(全額)
export const SBPS_ID_REFUND_PARTIAL = "ST02-00307-101";  // 部分返金

export interface RefundTarget {
  trackingId: string;         // 元決済の tracking_id (res_tracking_id) ← 主キー
  spsTransactionId?: string;  // 任意: 保持していれば付与
  custCode?: string;          // 任意: 元決済の cust_code (sb_history)
  orderId?: string;           // 任意: 元決済の order_id
}

// 返金リクエストの共通フィールドを組み立てる(存在する識別子のみ付与)。
function buildRefundFields(cfg: SbpsConfig, t: RefundTarget, amount: number | null, opts?: { requestDate?: string; limitSecond?: string }): Array<[string, string]> {
  const f: Array<[string, string]> = [
    ["merchant_id", cfg.merchantId],
    ["service_id", cfg.serviceId],
  ];
  if (t.spsTransactionId) f.push(["sps_transaction_id", t.spsTransactionId]);
  if (t.custCode) f.push(["cust_code", t.custCode]);
  if (t.orderId) f.push(["order_id", t.orderId]);
  f.push(["tracking_id", t.trackingId]);
  if (amount != null) f.push(["amount", String(Math.trunc(amount))]);
  f.push(["request_date", opts?.requestDate || sbpsRequestDate()]);
  f.push(["limit_second", opts?.limitSecond || "600"]);
  return f;
}

// 全額取消・返金
export async function sbpsRefundFull(
  cfg: SbpsConfig, t: RefundTarget, opts?: { dryRun?: boolean; requestDate?: string; limitSecond?: string }
): Promise<SbpsPostResult> {
  return sbpsPost(cfg, SBPS_ID_REFUND_FULL, buildRefundFields(cfg, t, null, opts), { dryRun: opts?.dryRun });
}

// 部分返金 (amount 円)
export async function sbpsRefundPartial(
  cfg: SbpsConfig, t: RefundTarget, amount: number, opts?: { dryRun?: boolean; requestDate?: string; limitSecond?: string }
): Promise<SbpsPostResult> {
  return sbpsPost(cfg, SBPS_ID_REFUND_PARTIAL, buildRefundFields(cfg, t, amount, opts), { dryRun: opts?.dryRun });
}
