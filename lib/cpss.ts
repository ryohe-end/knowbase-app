// lib/cpss.ts
// クレアンスメアード CPSS (ポイントSaaS) API クライアント。
// 役割分担: タウン・システム=自動付与 / knowbase=店舗アクション(参照・手動付与・取消・一括)。
//
// 認証: 毎リクエストのフォームボディに sid(SiteID) + spw(SitePW) を含める(トークン不要・ステートレス)。
//       result=json_utf8 でJSON応答。共通エンベロープ {status,msg,transid,code,result}、code="000-000-000" が成功。
// 環境: ブランドで別環境。JOYFIT=(stg-)yamauchi.nac.jp / FIT365=(stg-)wellness.nac.jp。
// 注意: CPSSは送信元IPホワイトリスト制(未許可は403)。Amplify SSRは動的IPのため、
//       本番接続は固定egress(プロキシ/Lambda)経由が必要 → 実接続時に別途対応。
//
// sid/spw は環境変数から取得:
//   CPSS_JOYFIT_STG_SID / CPSS_JOYFIT_STG_SPW / CPSS_JOYFIT_PROD_SID / ...
//   CPSS_FIT365_STG_SID / ... (未設定はエラー)

export type CpssBrand = "JOYFIT" | "FIT365";
export type CpssEnv = "stg" | "prod";

const BASE_URLS: Record<CpssBrand, Record<CpssEnv, string>> = {
  JOYFIT: { stg: "https://stg-yamauchi.nac.jp", prod: "https://yamauchi.nac.jp" },
  FIT365: { stg: "https://stg-wellness.nac.jp", prod: "https://wellness.nac.jp" },
};

export class CpssError extends Error {
  code: string; msg: string; transid?: string;
  constructor(code: string, msg: string, transid?: string) {
    super(`CPSS ${code}: ${msg}`);
    this.name = "CpssError"; this.code = code; this.msg = msg; this.transid = transid;
  }
}

function creds(brand: CpssBrand, env: CpssEnv): { sid: string; spw: string } {
  const p = `CPSS_${brand}_${env.toUpperCase()}`;
  const sid = (process.env[`${p}_SID`] || "").trim();
  const spw = (process.env[`${p}_SPW`] || "").trim();
  if (!sid || !spw) throw new Error(`CPSS 認証情報が未設定です (${p}_SID / ${p}_SPW)`);
  return { sid, spw };
}

type Envelope = { status?: string; msg?: string; transid?: string; code?: string; result?: any };

// 共通呼び出し (POST form-urlencoded + result=json_utf8)。code≠000-000-000 は CpssError。
async function call(
  brand: CpssBrand, env: CpssEnv, apiset: string, name: string,
  params: Record<string, string | number | undefined>,
  opts: { test?: boolean } = {}
): Promise<any> {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/${apiset}/api/${name}.php`;
  const body = new URLSearchParams();
  body.set("sid", sid); body.set("spw", spw); body.set("result", "json_utf8");
  if (opts.test) body.set("test", "1");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  if (res.status === 403) throw new CpssError("403", "IP未許可(送信元IPのホワイトリスト登録が必要)");
  const text = await res.text();
  let j: Envelope;
  try { j = JSON.parse(text); } catch { throw new CpssError(String(res.status), `非JSON応答: ${text.slice(0, 200)}`); }
  if (j.code && j.code !== "000-000-000") {
    // 001-006-000 = 同一reqidで処理済(冪等) → 成功扱いで result を返す
    if (j.code === "001-006-000") return j.result;
    throw new CpssError(j.code, j.msg || "エラー", j.transid);
  }
  return j.result;
}

// multipart (upload_point 用): file(TSV) をアップロード
async function callMultipart(
  brand: CpssBrand, env: CpssEnv, apiset: string, name: string,
  fileName: string, fileBuf: Buffer, extra: Record<string, string> = {}
): Promise<any> {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/${apiset}/api/${name}.php`;
  const form = new FormData();
  form.set("sid", sid); form.set("spw", spw); form.set("result", "json_utf8");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  form.set("file", new Blob([new Uint8Array(fileBuf)], { type: "text/csv" }), fileName);
  const res = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  if (res.status === 403) throw new CpssError("403", "IP未許可");
  const text = await res.text();
  let j: Envelope;
  try { j = JSON.parse(text); } catch { throw new CpssError(String(res.status), `非JSON応答: ${text.slice(0, 200)}`); }
  if (j.code && j.code !== "000-000-000") throw new CpssError(j.code, j.msg || "エラー", j.transid);
  return j.result;
}

// ===== 各API =====

// アプリ向け会員情報取得: ランク/残高/累計/次ランクまで
export async function getMemberForApp(brand: CpssBrand, env: CpssEnv, args: {
  aid: string; ptypes?: string; cumulus?: boolean; expires?: boolean; retattr?: string; shopid?: string;
}): Promise<any> {
  return call(brand, env, "cspm", "get_member_for_app", {
    aid: args.aid, ptypes: args.ptypes, shopid: args.shopid, retattr: args.retattr,
    cumulus: args.cumulus ? "true" : undefined, expires: args.expires ? "true" : undefined,
  });
}

// 店舗からの手動ポイント付与 (固定ポイント)。返り値に hid(履歴ID)。
export async function givePoint(brand: CpssBrand, env: CpssEnv, args: {
  aid: string; shopid: string; point: number; reqid: string; ptype?: string; hid?: string;
  action?: string; scode?: string; svalue?: string; empid?: string; test?: boolean;
}): Promise<{ aid: string; hid: string; ptype: string; point: number; balance: number }> {
  return call(brand, env, "cspm", "give_point", {
    aid: args.aid, shopid: args.shopid, point: args.point, reqid: args.reqid,
    ptype: args.ptype, hid: args.hid, action: args.action, scode: args.scode, svalue: args.svalue, empid: args.empid,
  }, { test: args.test });
}

// 会員のポイント利用(減算)。返り値に hid(取消に使用)。
export async function usePoint(brand: CpssBrand, env: CpssEnv, args: {
  aid: string; shopid: string; point: number; reqid: string; ptypes?: string; hid?: string;
  action?: string; scode?: string; svalue?: string; empid?: string; test?: boolean;
}): Promise<{ aid: string; hid: string; ptype: string; point: number; balance: number }> {
  return call(brand, env, "cspm", "use_point", {
    aid: args.aid, shopid: args.shopid, point: args.point, reqid: args.reqid,
    ptypes: args.ptypes, hid: args.hid, action: args.action, scode: args.scode, svalue: args.svalue, empid: args.empid,
  }, { test: args.test });
}

// 会員からの調整減算 (ポイント削除)。誤付与の調整等に使用。返り値に hid。
export async function removePoint(brand: CpssBrand, env: CpssEnv, args: {
  aid: string; shopid: string; point: number; reqid: string; ptypes?: string; hid?: string;
  scode?: string; svalue?: string; empid?: string; reason?: string; test?: boolean;
}): Promise<{ aid: string; hid: string; ptype: string; point: number; balance: number }> {
  return call(brand, env, "cspm", "remove_point", {
    aid: args.aid, shopid: args.shopid, point: args.point, reqid: args.reqid,
    ptypes: args.ptypes, hid: args.hid, scode: args.scode, svalue: args.svalue, empid: args.empid, reason: args.reason,
  }, { test: args.test });
}

// ポイント移動のキャンセル (hid 指定)
export async function cancelPoint(brand: CpssBrand, env: CpssEnv, args: {
  hid: string; shopid?: string; reason?: string; empid?: string; secid?: string; reqid?: string;
}): Promise<{ hid: string; ptype: string; point: number; from: any; to: any }> {
  return call(brand, env, "cspm", "cancel_point", {
    hid: args.hid, shopid: args.shopid, reason: args.reason, empid: args.empid, secid: args.secid, reqid: args.reqid,
  });
}

// 店舗向け一括ポイント処理 (TSVファイル)。reqid 必須。返り値に結果ファイル名。
export async function uploadPoint(brand: CpssBrand, env: CpssEnv, args: {
  tsv: string | Buffer; reqid: string; fileName?: string;
}): Promise<{ result_file_name: string }> {
  const buf = typeof args.tsv === "string" ? Buffer.from(args.tsv, "utf-8") : args.tsv;
  return callMultipart(brand, env, "cspm", "upload_point", args.fileName || `upload-${args.reqid}.tsv`, buf, { reqid: args.reqid });
}

// バッチログ状況のリスト取得 (upload_point の実行状況確認)
export async function getBatlogList(brand: CpssBrand, env: CpssEnv, args: {
  sdate: string; edate: string; fields?: string; bnames?: string; sort?: "asc" | "desc";
}): Promise<any> {
  return call(brand, env, "cpss", "get_batlog_list", {
    sdate: args.sdate, edate: args.edate,
    fields: args.fields || "bid,bname,aid,sdate,edate,fname,comment,rcode,emsg",
    bnames: args.bnames, sort: args.sort || "desc",
  });
}

// ファイルのダウンロード (バッチ結果/エラーファイル)。生のテキストを返す。
export async function downloadFile(brand: CpssBrand, env: CpssEnv, fileName: string): Promise<string> {
  const { sid, spw } = creds(brand, env);
  const url = `${BASE_URLS[brand][env]}/cpss/api/DownloadFile.php`;
  const body = new URLSearchParams({ sid, spw, V_FILENAME: fileName });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), cache: "no-store" });
  if (res.status === 403) throw new CpssError("403", "IP未許可");
  return res.text();
}

// 疎通確認
export async function isAlive(brand: CpssBrand, env: CpssEnv): Promise<boolean> {
  try { const r = await call(brand, env, "cpss", "is_alive", {}); return r?.status === "ok"; }
  catch { return false; }
}

// upload_point 用の TSV を組み立てる (31列・TAB区切り・ヘッダ有り・UTF-8/LF)
// rows: 手動付与の簡易指定 (コマンド give_point 想定)
export const UPLOAD_HEADERS = [
  "コマンド","ポイント処理日時","アカウントID","店舗ID","購入金額","ポイント数","ポイント履歴ID",
  "加算時ポイント種別","減算時ポイント種別","マイナス許可","有効化日時","有効期限切れ日時","業務コード",
  "業務データ","部門ID","従業員ID","ポイント処理理由","POS番号","レシート日時","レシート番号",
  "会員アカウントステータス","店舗アカウントステータス","追加アカウントID種別リスト","キャンセル理由",
  "返品レシートPOS番号","返品レシート日時","返品レシート番号","ポイント取り戻しモード",
  "減算履歴の業務コード","減算履歴の業務データ","減算履歴のポイント処理理由",
];
export function buildUploadTsv(rows: Array<Partial<Record<string, string | number>> & { command: string; aid: string; shopid: string; point?: number }>): string {
  const idx: Record<string, number> = { command: 0, "ポイント処理日時": 1, aid: 2, shopid: 3, "購入金額": 4, point: 5, hid: 6 };
  const lines = [UPLOAD_HEADERS.join("\t")];
  for (const r of rows) {
    const cols = new Array(UPLOAD_HEADERS.length).fill("");
    cols[0] = r.command; cols[2] = r.aid; cols[3] = r.shopid;
    if (r.point !== undefined) cols[5] = String(r.point);
    if ((r as any).hid) cols[6] = String((r as any).hid);
    if ((r as any).reason) cols[16] = String((r as any).reason);
    lines.push(cols.join("\t"));
  }
  return lines.join("\n") + "\n";
}
