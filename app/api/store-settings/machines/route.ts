// app/api/store-settings/machines/route.ts
// マシンマスタ (machine__c) の取得(GET) / 新規登録(POST)。
// ※ machine__c は旧Salesforce連携の残骸で現在SF同期は無効。id/name/sfid は
//    シーケンスdefaultで自動採番されるため、業務列だけINSERTすれば登録できる。
import { NextResponse } from "next/server";
import { query } from "@/lib/memberDb";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 会員アプリの部位表示は member-app-server の固定定数 MyConst.BODY_REGION に依存する。
// ここに無い部位で登録するとアプリのマシン画面に表示されないため、登録は選択式に限定する。
export const VALID_BODY_REGIONS = ["肩", "腕", "胸", "お腹", "背中", "腰", "脚"] as const;

export async function GET() {
  try {
    const result = await query(`
      SELECT
        machine_name__c AS "name",
        COALESCE(body_region__c, 'その他') AS "bodyRegion",
        COALESCE(img_url1__c, '') AS "imageUrl",
        CASE
          WHEN machine_name__c ~ '\\(.*\\)$'
          THEN regexp_replace(machine_name__c, '.*\\(([^)]+)\\)$', '\\1')
          ELSE 'その他'
        END AS "maker"
      FROM machine__c
      WHERE isdeleted = false
        AND machine_name__c IS NOT NULL
        AND machine_name__c != ''
      ORDER BY body_region__c, machine_name__c
    `);

    return NextResponse.json({ ok: true, machines: result.rows });
  } catch (e) {
    console.error("[machines API] DB error:", e);
    return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; maker?: string; bodyRegion?: string; imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const maker = (body.maker || "").trim();
  const bodyRegion = (body.bodyRegion || "").trim();
  const imageUrl = (body.imageUrl || "").trim();

  if (!name) return NextResponse.json({ ok: false, error: "マシン名は必須です" }, { status: 400 });
  if (!VALID_BODY_REGIONS.includes(bodyRegion as any)) {
    return NextResponse.json(
      { ok: false, error: `部位は次から選択してください: ${VALID_BODY_REGIONS.join(" / ")}` },
      { status: 400 }
    );
  }

  // メーカーは表示名の末尾括弧で表現する既存慣習に合わせる (例: "アブドミナル(HISTO)")
  const machineName = maker && !/\(.*\)$/.test(name) ? `${name}(${maker})` : name;

  try {
    // 重複チェック (論理削除以外)
    const dup = await query(
      `SELECT 1 FROM machine__c WHERE machine_name__c = $1 AND COALESCE(isdeleted, false) = false LIMIT 1`,
      [machineName]
    );
    if (dup.rows.length > 0) {
      return NextResponse.json({ ok: false, error: "同名のマシンが既に存在します" }, { status: 409 });
    }

    // id/name/sfid はシーケンスdefaultで自動採番。業務列のみINSERT。
    await query(
      `INSERT INTO machine__c (machine_name__c, body_region__c, img_url1__c, isdeleted, createddate, lastupdateddate)
       VALUES ($1, $2, $3, false, NOW(), NOW())`,
      [machineName, bodyRegion, imageUrl || null]
    );

    return NextResponse.json({
      ok: true,
      machine: { name: machineName, bodyRegion, imageUrl, maker: maker || "その他" },
    });
  } catch (e: any) {
    console.error("[machines API] INSERT error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "登録に失敗しました" }, { status: 500 });
  }
}
