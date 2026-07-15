// lambdas/cpss-proxy/handler.mjs (esbuild で index.mjs にバンドル)
// CPSS API を固定egress(34.199.173.5)から呼ぶプロキシ。knowbie-db-proxy と同じVPC/サブネットに置く。
// knowbie-frontend の店舗設定ルートから invoke され、CPSSのIP許可制をクリアする。
// 入力: { brand:"JOYFIT"|"FIT365", env:"stg"|"prod", action, args }
import * as cpss from "../../lib/cpss.ts";

export const handler = async (event) => {
  const brand = event?.brand === "FIT365" ? "FIT365" : "JOYFIT";
  const env = event?.env === "prod" ? "prod" : "stg";
  const action = event?.action;
  const a = event?.args || {};
  try {
    let result;
    switch (action) {
      case "isAlive": result = await cpss.isAlive(brand, env); break;
      case "getMemberForApp": result = await cpss.getMemberForApp(brand, env, a); break;
      case "givePoint": result = await cpss.givePoint(brand, env, a); break;
      case "usePoint": result = await cpss.usePoint(brand, env, a); break;
      case "removePoint": result = await cpss.removePoint(brand, env, a); break;
      case "cancelPoint": result = await cpss.cancelPoint(brand, env, a); break;
      case "uploadPoint": result = await cpss.uploadPoint(brand, env, { ...a, tsv: a.tsv }); break;
      case "getBatlogList": result = await cpss.getBatlogList(brand, env, a); break;
      case "downloadFile": result = await cpss.downloadFile(brand, env, a.fileName); break;
      default: return { ok: false, error: `unknown action: ${action}` };
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code, cpssMsg: e?.msg };
  }
};
