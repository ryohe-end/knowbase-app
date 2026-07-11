// app/api/store-settings/dm/csv-template/route.ts
// DM 宛先 CSV の雛形ダウンロード。Excel で文字化けしないよう UTF-8 BOM 付き。
// 列: 会員番号(任意), メールアドレス(必須), 氏名(任意)
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const header = "会員番号,メールアドレス,氏名";
  const sample = "3130003649,member@example.com,山田 太郎";
  const csv = `${header}\n${sample}\n`;
  const bom = "﻿"; // Excel 文字化け対策

  return new Response(bom + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dm_recipients_template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
