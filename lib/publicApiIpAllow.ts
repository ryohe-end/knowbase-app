// lib/publicApiIpAllow.ts
// 公開API(/api/public/*)の一部を「IP許可制」で保護するためのヘルパ。
// getMemberInfo は x-api-key ではなく、送信元IPで制限する(enrollmentMail/clubs/fees とは切り分け)。
//
// 実クライアントIPの判定(Amplify SSR = CloudFront 背後):
//   1. `cloudfront-viewer-address`(例 "13.159.44.116:12345" / "[2001:db8::1]:443") があれば最優先。
//   2. 無ければ `x-forwarded-for` の「右端(=最後)の公開IP」を採用。
//      CloudFront は実接続元IPを XFF の末尾に付与するため、末尾側が信頼できる。
//      左端はクライアントが自由に詐称できるので使わない。内部プロキシの private IP はスキップ。
//   3. さらに無ければ `x-real-ip`。
// 許可リストは env `KB_GETMEMBERINFO_ALLOW_IPS`(カンマ区切り)。既定に本番パートナーIPを内蔵。
import { NextResponse } from "next/server";

// 既定の許可IP(env未設定でも動くよう内蔵。env指定分は追加される)
const DEFAULT_ALLOW_IPS = [
  "13.159.44.116",
  "218.219.247.248", // 追加(2026-09-18 開発中の動作確認)
  "160.16.142.108",  // 追加(2026-09-18 開発中の動作確認)
];

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip.startsWith("10.") || ip.startsWith("127.") || ip.startsWith("192.168.")) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) { const o = Number(m[1]); if (o >= 16 && o <= 31) return true; }
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

// "1.2.3.4:5678" / "[::1]:443" / "1.2.3.4" → IP部分のみ
function stripPort(s: string): string {
  s = (s || "").trim();
  const v6 = s.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1];
  if ((s.match(/:/g) || []).length === 1) return s.split(":")[0]; // IPv4:port
  return s; // 素のIPv4 / bracket無しIPv6
}

/** 実クライアントIPを推定して返す。chosen=判定に使うIP, candidates=観測した全候補(ログ用)。 */
export function resolveClientIp(req: Request): { chosen: string | null; candidates: string[] } {
  const cfva = stripPort(req.headers.get("cloudfront-viewer-address") || "");
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map(stripPort).filter(Boolean);
  const xrip = stripPort(req.headers.get("x-real-ip") || "");
  const candidates = [cfva, ...xff, xrip].filter(Boolean);

  let chosen: string | null = null;
  if (cfva && !isPrivateIp(cfva)) {
    chosen = cfva;
  } else {
    for (let i = xff.length - 1; i >= 0; i--) {
      if (!isPrivateIp(xff[i])) { chosen = xff[i]; break; }
    }
  }
  if (!chosen && xrip && !isPrivateIp(xrip)) chosen = xrip;
  return { chosen, candidates };
}

/** 許可IP一覧(既定 + env)。 */
export function allowedIps(envKey = "KB_GETMEMBERINFO_ALLOW_IPS"): string[] {
  const fromEnv = (process.env[envKey] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set([...DEFAULT_ALLOW_IPS, ...fromEnv]));
}

/** IP許可NGなら NextResponse(403/503) を返す。OKなら null。 */
export function requireAllowedIp(req: Request, envKey = "KB_GETMEMBERINFO_ALLOW_IPS"): NextResponse | null {
  const allow = allowedIps(envKey);
  if (allow.length === 0) {
    return NextResponse.json({ ok: false, error: "ip_allowlist_not_configured" }, { status: 503 });
  }
  const { chosen, candidates } = resolveClientIp(req);
  if (!chosen || !allow.includes(chosen)) {
    // 許可外は理由を残す(パートナーの実IP位置を実測で確認できるよう候補も記録)
    console.warn(`[getMemberInfo] IP denied chosen=${chosen} candidates=${JSON.stringify(candidates)} xff="${req.headers.get("x-forwarded-for") || ""}" cfva="${req.headers.get("cloudfront-viewer-address") || ""}"`);
    return NextResponse.json({ ok: false, error: "forbidden_ip", ip: chosen }, { status: 403 });
  }
  return null;
}
