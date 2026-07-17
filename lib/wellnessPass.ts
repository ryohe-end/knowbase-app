// lib/wellnessPass.ts
// 法人ウェルネスパス(outsite/外部販売Sys)の全社集計。バッチ1トンネル + プロセス内キャッシュ。
// ダッシュボードと AI分析 で共有し、AI経路が毎回SSHトンネルを張らないようにする(SSR ~28s対策)。
import { sshBatch } from "@/lib/sshDbProxy";

export type WellnessAggregates = {
  monthly: { ym: string; orders: number; sales: number }[];
  byProvider: { provider: string; orders: number; sales: number }[];
  byProduct: { product: string; count: number; sales: number }[];
  byBrand: { brand: string; orders: number; sales: number }[];
  provByYm: Record<string, Record<string, number>>; // ym -> provider -> orders
};

const CACHE_TTL_MS = 10 * 60_000;
let _cache: { at: number; data: WellnessAggregates } | null = null;

export function isHqUser(u: any): boolean {
  return !!u && (u.role === "admin" || u.role === "finance" || u.role === "approver" || (Array.isArray(u.clubCodes) && u.clubCodes.length === 0));
}

export async function getWellnessAggregates(): Promise<{ ok: true; data: WellnessAggregates; cached: boolean } | { ok: false; error: string }> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return { ok: true, data: _cache.data, cached: true };

  const JST = "at time zone 'Asia/Tokyo'";
  const FROM = "o.created_dt >= (now() - interval '13 months')";
  const JOIN = "outsite.order_id_history o join outsite.payment_details p on p.uuid = o.uuid";
  const PROV = "left join (select uuid, min(from_system) fs, min(brand) br from outsite.access_control group by uuid) a on a.uuid = o.uuid";
  const res = await sshBatch("outsite", [
    { text: `select to_char(o.created_dt ${JST},'YYYY-MM') ym, count(distinct o.uuid) orders, coalesce(sum(p.bill_amount_tax),0) sales from ${JOIN} where ${FROM} group by 1 order by 1` },
    { text: `select coalesce(a.fs,'(不明)') provider, count(distinct o.uuid) orders, coalesce(sum(p.bill_amount_tax),0) sales from ${JOIN} ${PROV} where ${FROM} group by 1 order by sales desc` },
    { text: `select coalesce(p.product_name,'(不明)') product, count(*) cnt, coalesce(sum(p.bill_amount_tax),0) sales from ${JOIN} where ${FROM} group by 1 order by sales desc` },
    { text: `select coalesce(a.br,'(不明)') brand, count(distinct o.uuid) orders, coalesce(sum(p.bill_amount_tax),0) sales from ${JOIN} ${PROV} where ${FROM} group by 1 order by orders desc` },
    { text: `select to_char(o.created_dt ${JST},'YYYY-MM') ym, coalesce(a.fs,'(不明)') fs, count(distinct o.uuid) orders from ${JOIN} ${PROV} where ${FROM} group by 1,2` },
  ]);
  if (!res.ok) return { ok: false, error: res.error };
  const [mon, prov, prod, brand, provYm] = res.results.map((r) => r.rows);

  const provByYm: Record<string, Record<string, number>> = {};
  for (const r of provYm as any[]) (provByYm[r.ym] ||= {})[r.fs] = Number(r.orders);

  const data: WellnessAggregates = {
    monthly: (mon as any[]).map((r) => ({ ym: r.ym, orders: Number(r.orders), sales: Number(r.sales) })),
    byProvider: (prov as any[]).map((r) => ({ provider: r.provider, orders: Number(r.orders), sales: Number(r.sales) })),
    byProduct: (prod as any[]).map((r) => ({ product: (r.product || "").trim(), count: Number(r.cnt), sales: Number(r.sales) })),
    byBrand: (brand as any[]).map((r) => ({ brand: r.brand, orders: Number(r.orders), sales: Number(r.sales) })),
    provByYm,
  };
  _cache = { at: Date.now(), data };
  return { ok: true, data, cached: false };
}
