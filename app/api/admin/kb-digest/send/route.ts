// app/api/admin/kb-digest/send/route.ts
// KB通信を今すぐ配信。生成+全員送信は重いため Lambda(knowbie-kb-digest) に非同期投入し、即座に返す。
// ⚠ 連打防止: 非同期(Event)invoke は即返るため UI の二度押し防止だけでは全員配信(809人)が
//   何度も飛ぶ。DynamoDB のアトミックなクールダウンロックで直近 COOLDOWN 内の再送をブロックする。
//   意図的な再送は body.force=true（管理UIの「強制再配信」）で通す。
import { NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { isAdminRequest } from "@/lib/auth";
import { acquireSendLock } from "@/lib/kbDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGION = process.env.AWS_REGION || "us-east-1";
const FN = process.env.KB_DIGEST_FUNCTION || "knowbie-kb-digest";
// 全員配信の連打を防ぐクールダウン(既定30分)。この間の再配信は強制指定が無い限りブロック。
const COOLDOWN_MS = Number(process.env.KB_DIGEST_SEND_COOLDOWN_MS || 30 * 60_000);
const lambda = new LambdaClient({ region: REGION });

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  let body: { subject?: string; html?: string; force?: boolean } = {};
  try { body = await req.json(); } catch {}
  const force = body.force === true;

  // 連打防止ロック(アトミック)。取得失敗=直近に配信済み/配信中 → ブロック。
  let lock: { ok: boolean; lastAt?: number };
  try {
    lock = await acquireSendLock(COOLDOWN_MS, force);
  } catch (e: any) {
    // 権限エラー等。安全側に倒し、配信はしない(fail-closed)。
    console.error("[kb-digest/send] lock error:", e?.message);
    return NextResponse.json({ ok: false, error: "配信ロックの取得に失敗したため中止しました" }, { status: 500 });
  }
  if (!lock.ok) {
    const mins = Math.ceil(COOLDOWN_MS / 60_000);
    const lastStr = lock.lastAt
      ? new Date(lock.lastAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "直近";
    return NextResponse.json({
      ok: false, blocked: true,
      error: `連打防止: ${lastStr} に配信済み/配信中です。誤送信防止のため${mins}分間は再配信をブロックしました。意図的な再送は「強制再配信」を使ってください。`,
    }, { status: 429 });
  }

  try {
    await lambda.send(new InvokeCommand({
      FunctionName: FN,
      InvocationType: "Event", // 非同期(生成+配信をLambdaが実行)
      Payload: Buffer.from(JSON.stringify({ action: "send", subject: body.subject, html: body.html })),
    }));
    return NextResponse.json({ ok: true, started: true });
  } catch (e: any) {
    console.error("[kb-digest/send] invoke error:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message || "配信の起動に失敗しました" }, { status: 500 });
  }
}
