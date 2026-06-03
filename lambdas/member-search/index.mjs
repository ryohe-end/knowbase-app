// lambdas/member-search/index.mjs
// FIT_ADMIN 会員情報を検索する Lambda (Node.js 20 / oracledb Thin mode)
//
// 入力: API Gateway event.queryStringParameters
//   - type: "udid" | "member_no" | "phone" | "email" | "name_kanji" | "name_kana" | "kojin_seq"
//   - q:    検索値
//   - q2:   2nd 検索値 (name_kana の名 部分のみ使用)
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

  if (!type || !QUERIES[type]) {
    return resp(400, { error: "invalid_type", supported: Object.keys(QUERIES) });
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
