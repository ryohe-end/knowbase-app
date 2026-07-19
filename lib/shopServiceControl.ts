// lib/shopServiceControl.ts
//
// アプリの店舗別「表示サービス」設定の本番SoT。入会DB(fit365entry / joyfitentry)の
// shop_service_control(PK: shop_id char(6) × service_id, enabled tinyint) を直接読み書きする。
// 従来の DynamoDB オーバーレイ(yamauchi-StoreAppConfig)はアプリが読まない死蔵設定だった
// ため、これに置き換える。
//
// service_id はブランドで体系が異なる:
//   FIT365(fit365entry): 友達紹介=BPFINTRO / KIOSK主契約=CCKIOSK / 家族追加=FAMILYADD あり
//   JOYFIT(ecojoy=YGC-JOYFIT-ECOJOY入会DB): 友達紹介=EPFINTRO / FAMILYADD無し / CCKIOSKは
//     ツール上「未使用」表記のため編集対象外
//
// 【書込権限】fit365entry / ecojoy とも接続ユーザーは現状 UPDATE 可・INSERT不可の想定
//   (JOYFIT ecojoy は read-only ユーザーの場合あり)。書込可能ユーザー付与前提で canWrite=true。
import { sshBatch } from "@/lib/sshDbProxy";

export type ServiceBrand = "FIT365" | "JOYFIT";

// 管理画面トグルキー → service_id (ブランド別。null=そのブランドでは非対象)
type ToggleMap = Partial<Record<ServiceToggleKey, string>>;
export type ServiceToggleKey =
  | "showAppEnableButton"
  | "enableReferral"
  | "showMainContractChange"
  | "showKioskContractChange"
  | "showOptionChange"
  | "showFamilyAdd"
  | "showWithdrawal";

const FIT365_MAP: ToggleMap = {
  showAppEnableButton: "1",           // KIOSK：アプリ有効化ボタン
  enableReferral: "BPFINTRO",         // ベアレージP/友達紹介(通常会員)
  showMainContractChange: "CCAPP",    // お手続き画面：主契約変更
  showKioskContractChange: "CCKIOSK", // KIOSK：主契約変更
  showOptionChange: "CHANGEOP",       // オプション追加・解約
  showFamilyAdd: "FAMILYADD",         // 家族会員追加
  showWithdrawal: "WITHDRAWAL",       // 退会
};
const JOYFIT_MAP: ToggleMap = {
  showAppEnableButton: "1",           // アプリ有効化表示
  enableReferral: "EPFINTRO",         // エンジョイポイント(友達紹介入会含む)
  showMainContractChange: "CCAPP",    // お手続き画面：主契約変更
  // showKioskContractChange: CCKIOSKはJOYFITでは未使用 → 非対象
  showOptionChange: "CHANGEOP",       // オプション追加・解約(通常)
  // showFamilyAdd: JOYFITに家族追加サービスは無い → 非対象
  showWithdrawal: "WITHDRAWAL",       // 退会(通常)
};

export interface BrandConfig { target: string; map: ToggleMap; canWrite: boolean }

export function brandConfig(brand: ServiceBrand): BrandConfig {
  return brand === "JOYFIT"
    ? { target: "ecojoy", map: JOYFIT_MAP, canWrite: true } // YGC-JOYFIT-ECOJOY入会DB
    : { target: "fit365entry", map: FIT365_MAP, canWrite: true };
}

// 当該ブランドで編集可能なトグルキー一覧 (UIの出し分け用)
export function applicableToggles(brand: ServiceBrand): ServiceToggleKey[] {
  return Object.keys(brandConfig(brand).map) as ServiceToggleKey[];
}

// shop_id の対象サービスの enabled を読む。行が無いサービスは含めない(undefined)。
export async function getServiceControls(
  brand: ServiceBrand, shopId: string
): Promise<Partial<Record<ServiceToggleKey, boolean>>> {
  const { target, map } = brandConfig(brand);
  const serviceIds = Object.values(map);
  const toggleByService = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<string, ServiceToggleKey>;
  const placeholders = serviceIds.map(() => "?").join(",");
  const res = await sshBatch(target, [{
    text: `SELECT service_id, enabled FROM shop_service_control WHERE shop_id = ? AND service_id IN (${placeholders})`,
    params: [shopId, ...serviceIds],
  }]);
  if (!res.ok) throw new Error(res.error);
  const out: Partial<Record<ServiceToggleKey, boolean>> = {};
  for (const r of res.results[0].rows) {
    const tk = toggleByService[String(r.service_id)];
    if (tk) out[tk] = Number(r.enabled) === 1;
  }
  return out;
}

// 対象サービスの enabled を UPDATE する。返り値=書込サービス数。
// 接続DBユーザーは UPDATE 可・INSERT 不可のため、既存行のみ更新する(新規service行の
// プロビジョニングはしない)。呼び出し側は「行が存在するトグル」だけ渡すこと。
export async function saveServiceControls(
  brand: ServiceBrand, shopId: string, toggles: Partial<Record<ServiceToggleKey, boolean>>
): Promise<number> {
  const { target, map, canWrite } = brandConfig(brand);
  if (!canWrite) throw new Error(`${brand} の入会DBは現在書込権限がありません`);
  const writes: { text: string; params: any[] }[] = [];
  for (const [tk, sid] of Object.entries(map)) {
    if (!(tk in toggles)) continue;
    const enabled = toggles[tk as ServiceToggleKey] ? 1 : 0;
    writes.push({
      text: "UPDATE shop_service_control SET enabled=? WHERE shop_id=? AND service_id=?",
      params: [enabled, shopId, sid],
    });
  }
  if (writes.length === 0) return 0;
  const res = await sshBatch(target, writes);
  if (!res.ok) throw new Error(res.error);
  return writes.length;
}
