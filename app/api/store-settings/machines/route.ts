// app/api/store-settings/machines/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/memberDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
