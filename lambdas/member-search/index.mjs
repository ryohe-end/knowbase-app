// lambdas/member-search/index.mjs
// FIT_ADMIN 会員情報を検索する Lambda (Node.js 20 / oracledb Thin mode)
//
// 入力: API Gateway event.queryStringParameters
//   - type: "udid" | "member_no" | "phone" | "email" | "name_kanji" | "name_kana" | "kojin_seq"
//          | "refundable" (返金画面用: 会員+口座+入金歴)
//          | "club_addresses"
//   - q:    検索値
//   - q2:   2nd 検索値 (name_kana の名 部分のみ使用)
//
//   refundable 時の追加パラメータ:
//   - memberNo:  会員番号 (必須)
//   - clubCode:  クラブコード (必須)
//   - fromMonth: 検索開始 YYYYMM (任意, 省略時は 24ヶ月前)
//   - toMonth:   検索終了 YYYYMM (任意, 省略時は当月)
//
// 出力: { results: [...] }  -- 重複は kojin_seq+会員番号 単位で集約
//
// 環境変数:
//   ORACLE_SECRET_ARN  Secrets Manager の ARN ({ user, password, host, port, service })
//   AWS_REGION         (Lambda側で自動セット)

import oracledb from "oracledb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

oracledb.fetchAsString = [oracledb.CLOB, oracledb.DATE];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const SECRET_ARN = process.env.ORACLE_SECRET_ARN;
const REGION = process.env.AWS_REGION || "ap-northeast-1";

// --- 接続プール（コールドスタート時のみ初期化）-----------------------------
let poolPromise = null;
const sm = new SecretsManagerClient({ region: REGION });

async function getPool() {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    console.log("[diag] fetching secret from Secrets Manager");
    const secret = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
    console.log("[diag] secret fetched, creating pool");
    const cfg = JSON.parse(secret.SecretString);
    return oracledb.createPool({
      user: cfg.user,
      password: cfg.password,
      connectString: `${cfg.host}:${cfg.port}/${cfg.service}`,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 60,
      queueTimeout: 5000,
    });
  })();
  return poolPromise;
}

// --- SQL定義 -----------------------------------------------------------------
// 共通の SELECT 句。a=個人 / b=会員番号
// UDID は「現役 (会員番号_外部ID)」と「削除済 (会員番号_外部ID_削除)」を別カラムで返し、
// 表示時に active 優先 + 無ければ deleted を採用する。フラグ UDID_DELETED で出し分け。
// ROWNUM=1 で複数行があってもスカラ取得 (実運用は会員番号×種別=3 で実質1行のはず)。
const UDID_ACTIVE_SUBQ = `(
  SELECT 外部ID FROM FIT_ADMIN.会員番号_外部ID
   WHERE 会員番号 = b.会員番号 AND 外部ID種別コード = 3 AND ROWNUM = 1
)`;
const UDID_DELETED_SUBQ = `(
  SELECT 外部ID FROM FIT_ADMIN.会員番号_外部ID_削除
   WHERE 会員番号 = b.会員番号 AND 外部ID種別コード = 3 AND ROWNUM = 1
)`;
// 1会員 = 1契約者SEQ につき複数クラブ契約があり得るので、入会日 DESC で最新 1 件のみ。
const LATEST_CLUB_SUBQ = `(
  SELECT クラブコード FROM (
    SELECT クラブコード FROM FIT_ADMIN.会員クラブ契約
     WHERE 契約者SEQ = b.契約者SEQ
     ORDER BY "Tクラブ入会年月日" DESC NULLS LAST
  ) WHERE ROWNUM = 1
)`;

const BASE_SELECT = `
  SELECT
    a.個人SEQ                              AS KOJIN_SEQ,
    b.会員番号                              AS MEMBER_NO,
    a.漢字姓名                              AS NAME_KANJI,
    a.カナ姓                                AS NAME_KANA_SEI,
    a.カナ名                                AS NAME_KANA_MEI,
    CASE WHEN a.生年月日 BETWEEN 18000101 AND 30000101
         THEN SUBSTR(TO_CHAR(a.生年月日), 1, 4) || '-' ||
              SUBSTR(TO_CHAR(a.生年月日), 5, 2) || '-' ||
              SUBSTR(TO_CHAR(a.生年月日), 7, 2)
    END                                     AS BIRTHDAY,
    a.EMAIL                                 AS EMAIL,
    a.T連絡先TEL                            AS PHONE,
    ${UDID_ACTIVE_SUBQ}                     AS UDID_ACTIVE,
    ${UDID_DELETED_SUBQ}                    AS UDID_DELETED,
    ${LATEST_CLUB_SUBQ}                     AS CLUB_CODE
`;

const QUERIES = {
  // ① UDID検索: 現役 + 削除済 両方を UNION して 会員番号 → 個人 で取得
  udid: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.会員番号 b
    JOIN FIT_ADMIN.個人 a ON b.個人SEQ = a.個人SEQ
    WHERE b.会員番号 IN (
      SELECT 会員番号 FROM FIT_ADMIN.会員番号_外部ID
       WHERE 外部ID = :q AND 外部ID種別コード = 3
      UNION ALL
      SELECT 会員番号 FROM FIT_ADMIN.会員番号_外部ID_削除
       WHERE 外部ID = :q AND 外部ID種別コード = 3
    )
    FETCH FIRST 50 ROWS ONLY
  `,

  // ② 会員番号検索
  member_no: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.会員番号 b
    JOIN FIT_ADMIN.個人 a ON b.個人SEQ = a.個人SEQ
    WHERE b.会員番号 = :q
    FETCH FIRST 50 ROWS ONLY
  `,

  // ③ 漢字氏名検索 (個人.漢字姓名 にインデックス有)
  name_kanji: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.個人 a
    JOIN FIT_ADMIN.会員番号 b ON a.個人SEQ = b.個人SEQ
    WHERE a.漢字姓名 = :q
    FETCH FIRST 100 ROWS ONLY
  `,

  // ④ カナ姓+名 (姓だけでも可。名は q2)
  name_kana: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.個人 a
    JOIN FIT_ADMIN.会員番号 b ON a.個人SEQ = b.個人SEQ
    WHERE a.カナ姓 = :q
      AND (:q2 IS NULL OR a.カナ名 = :q2)
    FETCH FIRST 100 ROWS ONLY
  `,

  // ⑤ メール検索 (要 idx_kojin_email)
  email: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.個人 a
    JOIN FIT_ADMIN.会員番号 b ON a.個人SEQ = b.個人SEQ
    WHERE a.EMAIL = :q
    FETCH FIRST 50 ROWS ONLY
  `,

  // ⑥ 電話検索: 個人電話番号.検索用TEL (インデックス済) を入口に
  phone: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.個人電話番号 p
    JOIN FIT_ADMIN.個人     a ON p.個人SEQ = a.個人SEQ
    JOIN FIT_ADMIN.会員番号 b ON a.個人SEQ = b.個人SEQ
    WHERE p.検索用TEL = RPAD(:q, 15)
    FETCH FIRST 50 ROWS ONLY
  `,

  // ⑦ 個人SEQ直接 (詳細表示で使用)
  kojin_seq: `
    ${BASE_SELECT}
    FROM FIT_ADMIN.個人 a
    JOIN FIT_ADMIN.会員番号 b ON a.個人SEQ = b.個人SEQ
    WHERE a.個人SEQ = :q
  `,
};

// クラブ住所一括取得 (clubs-sync 用 / q 不要)
// FIT_ADMIN.CSクラブ は店舗マスタの拡張: 住所/郵便番号/TEL を持つ。
// 住所が NULL の店舗は同期対象外なので除外して返す。
const CLUB_ADDRESSES_SQL = `
  SELECT クラブコード AS CLUB_CODE,
         郵便番号    AS ZIP,
         住所        AS ADDRESS
    FROM FIT_ADMIN."CSクラブ"
   WHERE 住所 IS NOT NULL
`;

// --- 返金画面用: 会員+口座+入金歴 1ショット ---
// 会員契約者口座は 契約者SEQ ごとに複数行ある可能性があるため
// データ更新時刻 DESC で最新 1 件に絞る。
// 会員契約明細は 1:N の可能性があるため、対応 LIKE で絞り込まず最新の
// 契約形態のみを使う想定 (シンプル化のため明細フィルタは入れず JOIN は行う)。
const REFUNDABLE_SQL = `
  WITH latest_account AS (
    SELECT 契約者SEQ, 銀行支店コード, 預金種目コード, 口座番号, 預金者名,
           クレジットカードNO, 有効期限, ステータス1, ステータス2, ステータス3
      FROM (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY 契約者SEQ
                 ORDER BY データ更新時刻 DESC NULLS LAST
               ) AS rn
          FROM FIT_ADMIN.会員契約者口座 f
      )
     WHERE rn = 1
  )
  SELECT
    b.会員番号                                 AS MEMBER_NO,
    b.個人SEQ                                  AS KOJIN_SEQ,
    a.契約者SEQ                                AS KEIYAKUSHA_SEQ,
    a.契約SEQ                                  AS KEIYAKU_SEQ,
    c.クラブコード                             AS CLUB_CODE,
    c.会員区分コード                           AS PLAN_CODE,
    k.会員区分名                               AS PLAN_NAME,
    k.会員大区分コード                         AS PLAN_BIG_CODE,
    k.法人フラグ                               AS IS_CORPORATE,
    c.入会届出日                               AS JOIN_DATE,
    c.退会届出日                               AS WITHDRAWN_DECL_DATE,
    c.退会日                                   AS WITHDRAWN_DATE,
    a.対応年月                                 AS TARGET_YYYYMM,
    a.会費分類コード                           AS FEE_CATEGORY_CODE,
    h.会費分類名                               AS FEE_CATEGORY_NAME,
    a.月相当額                                 AS MONTHLY_AMOUNT,
    a.請求額                                   AS BILLED_AMOUNT,
    a.入金額                                   AS PAID_AMOUNT,
    a.入金年月日                               AS PAID_DATE,
    a.会費支払方式コード                       AS PAYMENT_METHOD_CODE,
    f.銀行支店コード                           AS BANK_BRANCH_CODE,
    f.預金種目コード                           AS DEPOSIT_TYPE_CODE,
    TRIM(f.口座番号)                           AS ACCOUNT_NUMBER,
    TRIM(f.預金者名)                           AS HOLDER_NAME,
    f.クレジットカードNO                       AS CREDIT_CARD_NO,
    f.有効期限                                 AS CARD_EXPIRY,
    f.ステータス1                              AS ACCOUNT_STATUS1,
    f.ステータス2                              AS ACCOUNT_STATUS2,
    f.ステータス3                              AS ACCOUNT_STATUS3
  FROM FIT_ADMIN.会員入金歴 a
  INNER JOIN FIT_ADMIN.会員番号 b       ON a.契約者SEQ = b.契約者SEQ
  INNER JOIN FIT_ADMIN.会員契約 c       ON a.契約SEQ   = c.契約SEQ
  LEFT  JOIN FIT_ADMIN.会員区分 k       ON c.会員区分コード = k.会員区分コード
  LEFT  JOIN FIT_ADMIN.会費分類 h       ON a.会費分類コード = h.会費分類コード
  INNER JOIN latest_account f           ON a.契約者SEQ = f.契約者SEQ
  WHERE b.会員番号 = :memberNo
    AND c.クラブコード = :clubCode
    AND a.対応年月 BETWEEN :fromMonth AND :toMonth
    AND a.入金額 > 0
  ORDER BY a.対応年月 DESC, a.会費分類コード
  FETCH FIRST 200 ROWS ONLY
`;

// --- 入金画面用: 未納項目 (請求はあるが未入金) ---
// 返金 SQL のフィルタを反転させたもの。口座 (latest_account) は任意。
const UNPAID_SQL = `
  WITH latest_account AS (
    SELECT 契約者SEQ, 銀行支店コード, 預金種目コード, 口座番号, 預金者名,
           クレジットカードNO, 有効期限, ステータス1, ステータス2, ステータス3
      FROM (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY 契約者SEQ
                 ORDER BY データ更新時刻 DESC NULLS LAST
               ) AS rn
          FROM FIT_ADMIN.会員契約者口座 f
      )
     WHERE rn = 1
  )
  SELECT
    b.会員番号                                 AS MEMBER_NO,
    b.個人SEQ                                  AS KOJIN_SEQ,
    a.契約者SEQ                                AS KEIYAKUSHA_SEQ,
    a.契約SEQ                                  AS KEIYAKU_SEQ,
    c.クラブコード                             AS CLUB_CODE,
    c.会員区分コード                           AS PLAN_CODE,
    k.会員区分名                               AS PLAN_NAME,
    k.法人フラグ                               AS IS_CORPORATE,
    a.対応年月                                 AS TARGET_YYYYMM,
    a.会費分類コード                           AS FEE_CATEGORY_CODE,
    h.会費分類名                               AS FEE_CATEGORY_NAME,
    a.月相当額                                 AS MONTHLY_AMOUNT,
    a.請求額                                   AS BILLED_AMOUNT,
    a.入金額                                   AS PAID_AMOUNT,
    a.請求年月日                               AS BILLED_DATE,
    a.会費支払方式コード                       AS PAYMENT_METHOD_CODE,
    f.銀行支店コード                           AS BANK_BRANCH_CODE,
    f.預金種目コード                           AS DEPOSIT_TYPE_CODE,
    TRIM(f.口座番号)                           AS ACCOUNT_NUMBER,
    TRIM(f.預金者名)                           AS HOLDER_NAME
  FROM FIT_ADMIN.会員入金歴 a
  INNER JOIN FIT_ADMIN.会員番号 b       ON a.契約者SEQ = b.契約者SEQ
  INNER JOIN FIT_ADMIN.会員契約 c       ON a.契約SEQ   = c.契約SEQ
  LEFT  JOIN FIT_ADMIN.会員区分 k       ON c.会員区分コード = k.会員区分コード
  LEFT  JOIN FIT_ADMIN.会費分類 h       ON a.会費分類コード = h.会費分類コード
  LEFT  JOIN latest_account f           ON a.契約者SEQ = f.契約者SEQ
  WHERE b.会員番号 = :memberNo
    AND c.クラブコード = :clubCode
    AND a.対応年月 BETWEEN :fromMonth AND :toMonth
    AND a.入金額 = 0
    AND a.請求額 > 0
  ORDER BY a.対応年月 ASC, a.会費分類コード
  FETCH FIRST 200 ROWS ONLY
`;

// --- 入力正規化 --------------------------------------------------------------
function normalize(type, q) {
  if (q == null) return q;
  let v = String(q).trim();
  if (type === "phone") {
    // 検索用TEL はハイフン・記号・空白を除去した形で格納されている前提
    v = v.replace(/[\s\-\(\)+]/g, "");
  }
  if (type === "email") {
    v = v.toLowerCase();
  }
  return v;
}

// --- メインハンドラ ----------------------------------------------------------
export const handler = async (event) => {
  console.log("[diag] handler entered");
  const params = event?.queryStringParameters || {};
  const type = params.type;
  const q = normalize(type, params.q);
  const q2 = params.q2 ? normalize(type, params.q2) : null;

  // 返金画面用: 会員+口座+入金歴 を 1ショットで返す
  if (type === "refundable") {
    const memberNo = (params.memberNo || "").trim();
    const clubCode = (params.clubCode || "").trim();
    if (!memberNo || !clubCode) {
      return resp(400, { error: "missing_params", required: ["memberNo", "clubCode"] });
    }
    // デフォルト期間: 直近 24 ヶ月
    const now = new Date();
    const defaultTo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const fromDate = new Date(now);
    fromDate.setMonth(fromDate.getMonth() - 24);
    const defaultFrom = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
    const fromMonth = (params.fromMonth || defaultFrom).trim();
    const toMonth = (params.toMonth || defaultTo).trim();

    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const result = await conn.execute(
        REFUNDABLE_SQL,
        { memberNo, clubCode, fromMonth: Number(fromMonth), toMonth: Number(toMonth) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const rows = result.rows || [];
      return resp(200, { results: buildRefundableResult(rows) });
    } catch (err) {
      console.error("refundable error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // 入金画面用: 未納項目を 1ショットで返す
  if (type === "unpaid") {
    const memberNo = (params.memberNo || "").trim();
    const clubCode = (params.clubCode || "").trim();
    if (!memberNo || !clubCode) {
      return resp(400, { error: "missing_params", required: ["memberNo", "clubCode"] });
    }
    // デフォルト期間: 直近 24 ヶ月 (未納はそれ以上遡るケースもあるが上限としては妥当)
    const now = new Date();
    const defaultTo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const fromDate = new Date(now);
    fromDate.setMonth(fromDate.getMonth() - 24);
    const defaultFrom = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
    const fromMonth = (params.fromMonth || defaultFrom).trim();
    const toMonth = (params.toMonth || defaultTo).trim();

    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const result = await conn.execute(
        UNPAID_SQL,
        { memberNo, clubCode, fromMonth: Number(fromMonth), toMonth: Number(toMonth) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      return resp(200, { results: buildUnpaidResult(result.rows || []) });
    } catch (err) {
      console.error("unpaid error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // クラブ住所一括取得は q 不要なので別経路
  if (type === "club_addresses") {
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const result = await conn.execute(CLUB_ADDRESSES_SQL, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      const addresses = (result.rows || []).map((r) => ({
        clubCode: r.CLUB_CODE != null ? String(r.CLUB_CODE) : null,
        zip:      r.ZIP != null ? String(r.ZIP).trim() : null,
        address:  r.ADDRESS,
      })).filter((a) => a.clubCode);
      return resp(200, { addresses, count: addresses.length });
    } catch (err) {
      console.error("club_addresses error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  if (!type || !QUERIES[type]) {
    return resp(400, { error: "invalid_type", supported: [...Object.keys(QUERIES), "club_addresses"] });
  }
  if (!q) {
    return resp(400, { error: "missing_q" });
  }

  let conn;
  try {
    console.log("[diag] before getPool");
    const pool = await getPool();
    console.log("[diag] after getPool, before getConnection");
    conn = await pool.getConnection();
    console.log("[diag] connection established, executing query");

    const binds = type === "name_kana" ? { q, q2 } : { q };
    const result = await conn.execute(QUERIES[type], binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const rows = (result.rows || []).map(rowToCamel);
    return resp(200, { results: rows, count: rows.length });
  } catch (err) {
    console.error("member-search error", err);
    return resp(500, { error: "internal_error", message: err.message });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) { /* noop */ }
    }
  }
};

// --- ヘルパ ------------------------------------------------------------------
// --- 返金画面用: SQL 結果を {member, account, items} に整形 ---
function buildRefundableResult(rows) {
  if (rows.length === 0) {
    return { member: null, account: null, items: [] };
  }
  const first = rows[0];

  // 銀行支店コード (10桁) = 銀行4桁 + 支店6桁
  const bankBranch = first.BANK_BRANCH_CODE != null ? String(first.BANK_BRANCH_CODE) : "";
  const bankCode = bankBranch.slice(0, 4) || null;
  const branchCode = bankBranch.slice(4) || null;

  const accountType = first.DEPOSIT_TYPE_CODE === 1 || first.DEPOSIT_TYPE_CODE === "1" ? "普通"
                    : first.DEPOSIT_TYPE_CODE === 2 || first.DEPOSIT_TYPE_CODE === "2" ? "当座"
                    : null;

  const isCreditCard = first.CREDIT_CARD_NO != null && String(first.CREDIT_CARD_NO).trim().length > 0;
  const isActive = !first.ACCOUNT_STATUS1 && !first.ACCOUNT_STATUS2 && !first.ACCOUNT_STATUS3;

  const account = bankBranch || isCreditCard
    ? {
        bankCode,
        bankName: null,
        branchCode,
        branchName: null,
        accountType,
        accountNumber: first.ACCOUNT_NUMBER != null ? String(first.ACCOUNT_NUMBER) : null,
        holderName: first.HOLDER_NAME != null ? String(first.HOLDER_NAME) : null,
        source: "登録済み（引落口座）",
        isCreditCard,
        isActive,
      }
    : null;

  const withdrawnRaw = first.WITHDRAWN_DATE != null ? String(first.WITHDRAWN_DATE) : null;
  const withdrawnAt = withdrawnRaw && withdrawnRaw.length === 8
    ? `${withdrawnRaw.slice(0, 4)}-${withdrawnRaw.slice(4, 6)}-${withdrawnRaw.slice(6, 8)}`
    : null;
  const memberStatus = withdrawnAt ? "withdrawn" : "active";

  const member = {
    memberNo: first.MEMBER_NO != null ? String(first.MEMBER_NO) : null,
    kojinSeq: first.KOJIN_SEQ != null ? String(first.KOJIN_SEQ) : null,
    name: null,                // 漢字氏名は別 SQL で取得 (本 SQL では未取得)
    kana: first.HOLDER_NAME != null ? String(first.HOLDER_NAME) : null,
    phone: null,
    plan: first.PLAN_NAME ?? null,
    planCode: first.PLAN_CODE ?? null,
    isCorporate: first.IS_CORPORATE === 1 || first.IS_CORPORATE === "1",
    joinClubCode: first.CLUB_CODE != null ? String(first.CLUB_CODE) : null,
    joinClubName: null,
    withdrawnAt,
    status: memberStatus,
  };

  const items = rows.map((r) => {
    const ymRaw = r.TARGET_YYYYMM != null ? String(r.TARGET_YYYYMM) : "";
    const targetMonth = ymRaw.length === 6
      ? `${ymRaw.slice(0, 4)}-${ymRaw.slice(4, 6)}`
      : ymRaw;
    const paidRaw = r.PAID_DATE != null ? String(r.PAID_DATE) : "";
    const paidAt = paidRaw.length === 8
      ? `${paidRaw.slice(0, 4)}-${paidRaw.slice(4, 6)}-${paidRaw.slice(6, 8)}`
      : null;
    const yyyy = ymRaw.slice(0, 4);
    const mm = ymRaw.slice(4, 6);
    const categoryName = r.FEE_CATEGORY_NAME ?? "その他";
    return {
      id: `${r.KEIYAKU_SEQ}-${ymRaw}-${r.FEE_CATEGORY_CODE}`,
      label: `${categoryName} (${yyyy}年${mm}月分)`,
      amount: Number(r.PAID_AMOUNT) || 0,
      paidAt,
      targetMonth,
      category: categoryName,
      categoryCode: r.FEE_CATEGORY_CODE ?? null,
      contractSeq: r.KEIYAKU_SEQ != null ? Number(r.KEIYAKU_SEQ) : null,
    };
  });

  return { member, account, items };
}

// --- 入金画面用: SQL 結果を {member, items} に整形 (口座は不要) ---
function buildUnpaidResult(rows) {
  if (rows.length === 0) {
    return { member: null, items: [] };
  }
  const first = rows[0];

  const member = {
    memberNo: first.MEMBER_NO != null ? String(first.MEMBER_NO) : null,
    kojinSeq: first.KOJIN_SEQ != null ? String(first.KOJIN_SEQ) : null,
    name: null,
    kana: first.HOLDER_NAME != null ? String(first.HOLDER_NAME) : null,
    phone: null,
    plan: first.PLAN_NAME ?? null,
    planCode: first.PLAN_CODE ?? null,
    isCorporate: first.IS_CORPORATE === 1 || first.IS_CORPORATE === "1",
    joinClubCode: first.CLUB_CODE != null ? String(first.CLUB_CODE) : null,
  };

  const today = new Date();
  const items = rows.map((r) => {
    const ymRaw = r.TARGET_YYYYMM != null ? String(r.TARGET_YYYYMM) : "";
    const targetMonth = ymRaw.length === 6
      ? `${ymRaw.slice(0, 4)}-${ymRaw.slice(4, 6)}`
      : ymRaw;
    const billedRaw = r.BILLED_DATE != null ? String(r.BILLED_DATE) : "";
    // 請求年月日 (YYYYMMDD) → "YYYY-MM-DD"
    const dueDate = billedRaw.length === 8
      ? `${billedRaw.slice(0, 4)}-${billedRaw.slice(4, 6)}-${billedRaw.slice(6, 8)}`
      : null;
    // 経過日数 (請求日からの日数 — 厳密な支払期限ではないが目安)
    let overdueDays = null;
    if (dueDate) {
      const d = new Date(dueDate);
      if (!Number.isNaN(d.getTime())) {
        overdueDays = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
      }
    }
    const yyyy = ymRaw.slice(0, 4);
    const mm = ymRaw.slice(4, 6);
    const categoryName = r.FEE_CATEGORY_NAME ?? "その他";
    return {
      id: `${r.KEIYAKU_SEQ}-${ymRaw}-${r.FEE_CATEGORY_CODE}`,
      label: `${categoryName} (${yyyy}年${mm}月分)`,
      amount: Number(r.BILLED_AMOUNT) || 0,
      targetMonth,
      dueDate,
      overdueDays,
      category: categoryName,
      categoryCode: r.FEE_CATEGORY_CODE ?? null,
      contractSeq: r.KEIYAKU_SEQ != null ? Number(r.KEIYAKU_SEQ) : null,
      oracleInvoiceId: `INV-${ymRaw}-${r.KOJIN_SEQ}-${r.FEE_CATEGORY_CODE}`,
    };
  });

  return { member, items };
}

function rowToCamel(r) {
  const udidActive = r.UDID_ACTIVE ?? null;
  const udidDel    = r.UDID_DELETED ?? null;
  return {
    kojinSeq:    r.KOJIN_SEQ != null ? String(r.KOJIN_SEQ) : null,
    memberNo:    r.MEMBER_NO != null ? String(r.MEMBER_NO) : null,
    nameKanji:   r.NAME_KANJI,
    nameKanaSei: r.NAME_KANA_SEI,
    nameKanaMei: r.NAME_KANA_MEI,
    birthday:    r.BIRTHDAY,
    email:       r.EMAIL,
    phone:       r.PHONE != null ? String(r.PHONE).trim() : null,
    udid:        udidActive ?? udidDel,
    udidDeleted: udidActive == null && udidDel != null,
    clubCode:    r.CLUB_CODE != null ? String(r.CLUB_CODE) : null,
  };
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
