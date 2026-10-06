// lib/bi.ts
// BIダッシュボード共通ヘルパー。各 app/api/bi/* から使う。
// - buildWhere: DMに存在する列だけをフィルタに使う(集計DMでクラブ属性の深さが違うため=R-03)。
//   期間は TO_VARCHAR で型差(NUMBER/TEXT)を吸収し 'YYYYMM' の文字列比較で統一。
//   クラブは複数選択(カンマ区切りコード)→ IN。
// - clubOptions: フィルタ候補(DM_クラブマスタ由来)。
import { sfQuery } from "@/lib/snowflake";

export type BiFilters = {
  brand?: string; gyotai?: string; area?: string; company?: string; gyosha?: string;
  club?: string; // カンマ区切りのクラブコード(複数選択)
  memberType?: string; from?: string; to?: string;
};

export function parseFilters(url: string): BiFilters {
  const sp = new URL(url).searchParams;
  const g = (k: string) => sp.get(k) || undefined;
  return { brand: g("brand"), gyotai: g("gyotai"), area: g("area"), company: g("company"), gyosha: g("gyosha"),
    club: g("club"), memberType: g("memberType"), from: g("from"), to: g("to") };
}

/**
 * @param f       フィルタ
 * @param cols    そのDMに存在する列名の集合
 * @param periodCol 期間列名(例 "営業年月","購入年月","請求月")。無指定ならフィルタ期間は無効
 */
export function buildWhere(f: BiFilters, cols: Set<string>, periodCol?: string) {
  const conds: string[] = [];
  const binds: (string | number)[] = [];
  const has = (c: string) => cols.has(c);
  const eq = (col: string, val?: string) => {
    if (val && val.trim() && has(col)) { conds.push(`"${col}" = ?`); binds.push(val); }
  };
  eq("ブランド", f.brand);
  eq("業態", f.gyotai);
  eq("エリア", f.area);
  eq("カンパニー", f.company);
  eq("企業", f.gyosha);
  eq("会員種別", f.memberType);
  // クラブ複数選択(カンマ区切りコード)
  if (f.club && has("クラブコード")) {
    const codes = f.club.split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    if (codes.length) { conds.push(`"クラブコード" IN (${codes.map(() => "?").join(",")})`); codes.forEach((c) => binds.push(Number(c))); }
  }
  if (periodCol && has(periodCol)) {
    if (f.from && /^\d{6}$/.test(f.from)) { conds.push(`TO_VARCHAR("${periodCol}") >= ?`); binds.push(f.from); }
    if (f.to && /^\d{6}$/.test(f.to)) { conds.push(`TO_VARCHAR("${periodCol}") <= ?`); binds.push(f.to); }
  }
  return { clause: conds.length ? "WHERE " + conds.join(" AND ") : "", binds };
}

export const N = (v: any) => (v == null ? 0 : Number(v));

export async function clubOptions() {
  const clubs = await sfQuery(
    `SELECT "クラブコード" code, "クラブ略称" name, "業態" gyotai, "ブランド" brand, "エリア" area, "カンパニー" company, "企業" gyosha
     FROM MART."DM_クラブマスタ" ORDER BY "クラブコード"`);
  const uniq = (a: any[]) => Array.from(new Set(a.filter(Boolean))).sort();
  return {
    brands: uniq(clubs.map((c: any) => c.BRAND)),
    gyotais: uniq(clubs.map((c: any) => c.GYOTAI)),
    areas: uniq(clubs.map((c: any) => c.AREA)),
    companies: uniq(clubs.map((c: any) => c.COMPANY)),
    gyoshas: uniq(clubs.map((c: any) => c.GYOSHA)),
    clubs: clubs.map((c: any) => ({ code: N(c.CODE), name: String(c.NAME ?? c.CODE), brand: c.BRAND, area: c.AREA, company: c.COMPANY, gyosha: c.GYOSHA })),
    memberTypes: ["課金会員", "家族会員"],
  };
}
