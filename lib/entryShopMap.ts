// lib/entryShopMap.ts
//
// clubCode(会員DB/knowbie) → 入会DB(fit365entry / ecojoy)の shop_id を【自動】解決する。
// 入会DBの shop_convert_view が正式な対応表:  casio_shop_id = LPAD(clubCode,6,'0') → town_shop_id。
// shop_service_control / unpaid_history 等はこの town_shop_id(=shop.shop_id) をキーに使う。
//   FIT365(fit365entry): 例 clubCode 375 → casio '000375' → town '000123'
//   JOYFIT(ecojoy)     : 例 clubCode 101 → casio '000101' → town '000101'
// shop_convert_view は数百行の静的な小テーブルなので target 別に10分キャッシュ。
import { sshBatch } from "@/lib/sshDbProxy";
import type { ServiceBrand } from "@/lib/shopServiceControl";
import { brandConfig } from "@/lib/shopServiceControl";

const CACHE_MS = 10 * 60 * 1000;
export const casioOf = (clubCode: string) => String(clubCode).replace(/\D/g, "").padStart(6, "0").slice(-6);

const cache = new Map<string, { at: number; casioToTown: Map<string, string> }>();

async function loadConvMap(target: string): Promise<Map<string, string>> {
  const c = cache.get(target);
  if (c && Date.now() - c.at < CACHE_MS) return c.casioToTown;
  const res = await sshBatch(target, [{ text: "SELECT casio_shop_id, town_shop_id FROM shop_convert_view", params: [] }]);
  if (!res.ok) { if (c) return c.casioToTown; throw new Error(res.error); }
  const casioToTown = new Map<string, string>();
  for (const r of res.results[0].rows) casioToTown.set(String(r.casio_shop_id), String(r.town_shop_id));
  cache.set(target, { at: Date.now(), casioToTown });
  return casioToTown;
}

// clubCode → 入会DBの shop_id(town_shop_id)。対応が無ければ null。
export async function resolveEntryShopId(
  brand: ServiceBrand, clubCode: string, _clubNameHint?: string
): Promise<string | null> {
  const { target } = brandConfig(brand);
  const map = await loadConvMap(target);
  return map.get(casioOf(clubCode)) ?? null;
}
