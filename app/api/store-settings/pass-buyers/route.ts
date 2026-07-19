// app/api/store-settings/pass-buyers/route.ts
//
// DM宛先として「1dayパス / OneTimePass(EnjoyTimePass) 購入者」のメールアドレスを
// 店舗フィルタで引用する。担当店舗スコープ内のみ。
//   1day(FIT365)      : one_day_ticket ⋈ shop_convert_view(casio_shop_id=LPAD(clubCode,6)) ⋈ member → pc/mobile_mail_address
//   OneTimePass(JOYFIT): t1pass.ticket_tbl(club_cd) ⋈ user_tbl → mail_address
//
//   POST { clubCodes: string[], sources: ("oneday"|"onetime")[] }  → { recipients: [{email,name,memberNo,shopName,source}], counts }
import { NextResponse } from "next/server";
import { getRefundUser, isClubInScope } from "@/lib/refundAuth";
import { sshBatch, sshQuery } from "@/lib/sshDbProxy";
import { getClubBusinessType, cpssBrandForBusinessType } from "@/lib/clubScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 8000;
const casioOf = (c: string) => String(c).replace(/\D/g, "").padStart(6, "0").slice(-6);

export async function POST(req: Request) {
  const user = await getRefundUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const clubCodes: string[] = Array.isArray(body?.clubCodes) ? body.clubCodes.map((c: any) => String(c).trim()).filter(Boolean) : [];
  const sources: string[] = Array.isArray(body?.sources) ? body.sources : ["oneday", "onetime"];
  if (clubCodes.length === 0) return NextResponse.json({ error: "店舗を指定してください" }, { status: 400 });
  // 担当外店舗を弾く
  const bad = clubCodes.filter((c) => !isClubInScope(user, c));
  if (bad.length > 0) return NextResponse.json({ error: `担当外の店舗が含まれています（${bad.join(",")}）` }, { status: 403 });

  const recipients: { email: string; name: string; memberNo: string; shopName: string; source: string }[] = [];
  const seen = new Set<string>();
  const push = (email: string, name: string, memberNo: string, shopName: string, source: string) => {
    const e = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(e) || seen.has(e) || recipients.length >= MAX) return;
    seen.add(e);
    recipients.push({ email: e, name: name || "", memberNo: memberNo || "", shopName: shopName || "", source });
  };
  const errors: string[] = [];

  // 1day (FIT365 / fit365entry)
  if (sources.includes("oneday")) {
    const casios = clubCodes.map(casioOf);
    const res = await sshBatch("fit365entry", [{
      text: `SELECT DISTINCT COALESCE(NULLIF(m.pc_mail_address,''), m.mobile_mail_address) email, t.member_no, sp.name shop_name
               FROM one_day_ticket t
               INNER JOIN shop_convert_view spv ON spv.town_shop_id=t.shop_id
               INNER JOIN shop sp ON sp.shop_id=t.shop_id
               INNER JOIN member m ON m.member_no=t.member_no
              WHERE t.payment_flg=1 AND t.del_flg=0
                AND spv.casio_shop_id IN (${casios.map(() => "?").join(",")})
                AND COALESCE(NULLIF(m.pc_mail_address,''), m.mobile_mail_address) IS NOT NULL
              LIMIT ${MAX}`,
      params: casios,
    }]);
    if (!res.ok) errors.push(`1day: ${res.error}`);
    else for (const r of res.results[0].rows) push(r.email, "", String(r.member_no || ""), String(r.shop_name || ""), "1day");
  }

  // OneTimePass (JOYFIT / t1pass)。t1pass の club_cd は clubCode と同値だが JOYFIT 採番のため、
  // FIT365 の clubCode が別ブランドの club_cd と数値衝突しないよう、JOYFITクラブのみ対象にする。
  if (sources.includes("onetime")) {
    const brandPairs = await Promise.all(clubCodes.map(async (c) => ({ c, brand: cpssBrandForBusinessType(await getClubBusinessType(c)) })));
    const joyfitCodes = brandPairs.filter((p) => p.brand === "JOYFIT").map((p) => p.c);
    const nums = joyfitCodes.map((c) => Number(c)).filter((n) => Number.isFinite(n));
    if (nums.length > 0) {
      const res = await sshQuery(
        "onetimepass",
        `select distinct u.mail_address email, coalesce(u.name,'') name, u.cust_code member_no, c.club_name shop_name
           from t1pass.ticket_tbl t
           join t1pass.user_tbl u on u.access_key=t.access_key
           left join t1pass.club_tbl c on c.club_cd=t.club_cd
          where t.club_cd = ANY($1::int[]) and u.mail_address is not null and u.mail_address<>''
          limit ${MAX}`,
        [nums]
      );
      if (!res.ok) errors.push(`OneTimePass: ${res.error}`);
      else for (const r of res.rows) push(r.email, String(r.name || ""), String(r.member_no || ""), String(r.shop_name || ""), "OneTimePass");
    }
  }

  return NextResponse.json({
    recipients,
    counts: { total: recipients.length, oneday: recipients.filter((r) => r.source === "1day").length, onetime: recipients.filter((r) => r.source === "OneTimePass").length },
    limited: recipients.length >= MAX,
    warnings: errors.length ? errors : undefined,
  });
}
