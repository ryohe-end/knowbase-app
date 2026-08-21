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
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"; // ビーコン同期でdb-proxy呼出 (runtime同梱)

// ビーコン日次同期: Oracleゲート/ビーコンから (major=クラブコード, minor=WSコード) を取得。
// UUID = "クラブコード-WSコード" = major-minor。場所名=エリア名称【コメント】。
const BEACON_SOURCE_SQL = `
  SELECT DISTINCT
    g.クラブコード AS CLUB_CODE,
    g.WSコード     AS WS,
    DECODE(g.WSコード,1,'ゲート入館',2,'ゲート出館',3,'浴室入館',4,'浴室出館',5,'浴室入館2',6,'浴室出館2',
           e.エリア名称||DECODE(e.コメント,NULL,'','【'||e.コメント||'】')) AS PLACE_NAME,
    e.コメント     AS MEMO
  FROM FIT_ADMIN.ゲートコントロールマスタ g
  INNER JOIN FIT_ADMIN.PDAゲートNO変換 p ON p.クラブコード = g.クラブコード AND p.PDAコード = g.WSコード
  INNER JOIN FIT_ADMIN.クラブWS w        ON w.クラブコード = p.クラブコード AND w.WSコード = p.WSコード
  LEFT  JOIN FIT_ADMIN.エリア入室設定 e  ON e.クラブコード = w.クラブコード AND e.エリアコード = w.入場エリアコード
  WHERE g.状態コード <> 0
`;

const DB_PROXY_FN = process.env.DB_PROXY_FUNCTION_NAME || "knowbie-db-proxy";
const DB_PROXY_REGION = process.env.DB_PROXY_REGION || "us-east-1";
const _lambda = new LambdaClient({ region: DB_PROXY_REGION });

// db-proxy(Fly PG) 経由でSQL実行
async function proxyQuery(text, params) {
  const res = await _lambda.send(new InvokeCommand({
    FunctionName: DB_PROXY_FN,
    Payload: Buffer.from(JSON.stringify({ text, params, target: "member" })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload).toString());
  if (!payload || payload.ok !== true) throw new Error("db-proxy: " + (payload && payload.error ? payload.error : "unknown"));
  return payload.rows || [];
}

// ビーコン日次同期本体: Oracleの解錠機器を Fly PG unlocking_machine_code__c に
// (club_sfid, major, minor) が無い新規のみ INSERT する。既存は上書きしない。
async function beaconSync() {
  let conn;
  try {
    const pool = await getPool();
    conn = await pool.getConnection();
    const beacons = (await conn.execute(BEACON_SOURCE_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows || [];

    const clubCodes = [...new Set(beacons.map((b) => String(b.CLUB_CODE)))];
    if (clubCodes.length === 0) return resp(200, { ok: true, action: "beacon_sync", scanned: 0, inserted: 0 });

    // club_code -> sfid
    const clubRows = await proxyQuery(
      `SELECT club_code__c AS code, sfid FROM club__c WHERE club_code__c = ANY($1) AND COALESCE(isdeleted,false)=false`,
      [clubCodes]
    );
    const sfidByCode = new Map(clubRows.map((r) => [String(r.code), r.sfid]));
    const sfids = [...sfidByCode.values()];

    // 既存 major-minor
    const existing = new Set();
    if (sfids.length) {
      const exRows = await proxyQuery(
        `SELECT major__c, minor__c FROM unlocking_machine_code__c WHERE club_sfid__c = ANY($1) AND COALESCE(isdeleted,false)=false`,
        [sfids]
      );
      for (const r of exRows) existing.add(`${r.major__c}-${r.minor__c}`);
    }

    // 新規のみ収集 (バッチINSERT用。db-proxy往復を1回に抑える)
    const cols = { sfid: [], major: [], minor: [], door: [], disp: [], entrance: [] };
    let skipped = 0, noClub = 0;
    const newlyInserted = [];
    const seenThisRun = new Set();
    for (const b of beacons) {
      const major = String(b.CLUB_CODE), minor = String(b.WS);
      const sfid = sfidByCode.get(major);
      if (!sfid) { noClub++; continue; }
      const key = `${major}-${minor}`;
      if (existing.has(key) || seenThisRun.has(key)) { skipped++; continue; }
      seenThisRun.add(key);
      const placeName = (b.PLACE_NAME || `WS${minor}`).toString().slice(0, 255);
      const memo = b.MEMO ? String(b.MEMO).slice(0, 255) : null;
      const isEntrance = minor === "1" || /入館/.test(placeName);
      cols.sfid.push(sfid); cols.major.push(major); cols.minor.push(minor);
      cols.door.push(memo || placeName); cols.disp.push(placeName); cols.entrance.push(isEntrance);
      newlyInserted.push({ major, minor, placeName });
    }
    const inserted = cols.sfid.length;
    if (inserted > 0) {
      await proxyQuery(
        `INSERT INTO unlocking_machine_code__c
           (club_sfid__c, major__c, minor__c, door_type__c, display_name__c, is_for_entrance__c, isdeleted)
         SELECT sfid, major, minor, door, disp, entrance, false
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[])
                AS t(sfid, major, minor, door, disp, entrance)`,
        [cols.sfid, cols.major, cols.minor, cols.door, cols.disp, cols.entrance]
      );
    }
    console.log(`[beacon_sync] scanned=${beacons.length} inserted=${inserted} skipped=${skipped} noClub=${noClub}`);
    return resp(200, { ok: true, action: "beacon_sync", scanned: beacons.length, inserted, skipped, noClub, sample: newlyInserted.slice(0, 20) });
  } catch (err) {
    console.error("beacon_sync error", err);
    return resp(500, { error: "internal_error", message: err.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
  }
}

// ── elock(YGC電子錠) club_beacon への日次同期 ─────────────────────────────
// Oracleゲート系から (machine_id=クラブコード-WSコード, club_cd, memo=クラブ略称+エリア名称) を作り、
// elock.club_beacon に未存在のものだけ INSERT する(新規のみ・既存は温存)。
// beacon_use はエリア名称/WSコードから推測(既存2718件で97%一致・相互利用オプションエリア→入口)。
// per_use_ticket_rule / indirect_use は手動管理列のため一切触らない。
const BEACON_ELOCK_SQL = `
  SELECT DISTINCT
    g.クラブコード AS CLUB_CODE,
    g.WSコード     AS WS,
    c.クラブ略称   AS CLUB_SHORT,
    DECODE(g.WSコード,1,'ゲート入口',2,'ゲート出口',3,'ビル入口',4,'ビル出口',5,'ビル入口2',6,'ビル出口2',
           e.エリア名称||DECODE(e.コメント,NULL,'','【'||e.コメント||'】')) AS PLACE_NAME
  FROM FIT_ADMIN.ゲートコントロールマスタ g
  INNER JOIN FIT_ADMIN.PDAゲートNO変換 p ON p.クラブコード = g.クラブコード AND p.PDAコード = g.WSコード
  INNER JOIN FIT_ADMIN.クラブWS w        ON w.クラブコード = p.クラブコード AND w.WSコード = p.WSコード
  LEFT  JOIN FIT_ADMIN.エリア入室設定 e  ON e.クラブコード = w.クラブコード AND e.エリアコード = w.入場エリアコード
  LEFT  JOIN FIT_ADMIN.クラブ c          ON c.クラブコード = g.クラブコード
  WHERE g.状態コード <> 0
`;

// beacon_use 推測ルール(既存データから逆算・97%一致)。施設語→WSコード→エリア扉→入口/出口の優先順。
function classifyBeaconUse(place, ws) {
  const m = String(place || "");
  const w = Number(ws);
  if (m.includes("水素水")) return "HYDW";
  if (m.includes("タンニング")) return "TAN";
  if (m.includes("コラーゲン")) return "CLGN";
  if (m.includes("プロテイン")) return "PRTN";
  if (m.includes("ボディプランナー") || m.includes("ボディープランナー") || m.toUpperCase().includes("INBODY")) return "BDPL";
  if (m.includes("シャワー")) return "SHWR";
  if (m.includes("相互利用") || m.includes("オプションエリア")) return "IND"; // 相互利用オプションエリア=入口扱い
  if (w === 1 || w === 3 || w === 5) return "IND";
  if (w === 2 || w === 4 || w === 6) return "OUTD";
  if (["更衣室", "ロッカー", "ジムエリア", "女性用", "パウダールーム", "トイレ"].some((k) => m.includes(k))) return "DROM";
  if (m.includes("入口") || m.includes("入館")) return "IND";
  if (m.includes("出口") || m.includes("出館")) return "OUTD";
  return "NOTD";
}

// ssh-db-proxy(us-east-1) 経由で elock(Postgres) にクエリ
const SSH_PROXY_FN = process.env.SSH_DB_PROXY_FUNCTION || "knowbie-ssh-db-proxy";
async function elockQuery(text, params) {
  const res = await _lambda.send(new InvokeCommand({
    FunctionName: SSH_PROXY_FN,
    Payload: Buffer.from(JSON.stringify({ target: "elock", text, params })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload).toString());
  if (!payload || payload.ok !== true) throw new Error("elock-proxy: " + (payload && payload.error ? payload.error : "unknown"));
  return payload.rows || [];
}

async function beaconSyncElock({ dryRun = false } = {}) {
  let conn;
  try {
    const pool = await getPool();
    conn = await pool.getConnection();
    const rows = (await conn.execute(BEACON_ELOCK_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows || [];

    // 変換 (machine_id=クラブコード-WSコード。同一キーは1件に集約)
    const seen = new Set();
    const items = [];
    let xSkipped = 0, notdSkipped = 0;
    for (const r of rows) {
      const club = String(r.CLUB_CODE);
      const ws = String(r.WS);
      const machineId = `${club}-${ws}`;
      if (seen.has(machineId)) continue;
      seen.add(machineId);
      const place = (r.PLACE_NAME || "").toString();
      const short = (r.CLUB_SHORT || "").toString();
      // ×クラブ(クラブ略称が×で始まる=移転/廃止等)は従来どおり除外
      if (short.startsWith("×")) { xSkipped++; continue; }
      const use = classifyBeaconUse(place, ws);
      // NOTD(スタジオ/レンタルルーム/プレミアムルーム/セルフエステ等の"部屋")は従来除外
      if (use === "NOTD") { notdSkipped++; continue; }
      const memo = (short + place).slice(0, 255) || null;
      items.push({ machineId, clubCd: Number(club), use, memo });
    }

    // elock 既存 machine_id
    const exRows = await elockQuery(`select machine_id from club_beacon`, []);
    const existing = new Set(exRows.map((r) => r.machine_id));
    const newItems = items.filter((it) => !existing.has(it.machineId));

    if (dryRun) {
      const dist = {};
      for (const it of newItems) dist[it.use] = (dist[it.use] || 0) + 1;
      // 既存にあるが今回のソースに無い machine_id (=私のクエリが再現できない既存)
      const candIds = new Set(items.map((i) => i.machineId));
      const existingNotInSource = [...existing].filter((id) => !candIds.has(id));
      // 新規のうち「既存に1件も無いクラブ(まるごと新規)」
      const existClubs = new Set([...existing].map((id) => id.split("-")[0]));
      const newInNewClub = newItems.filter((i) => !existClubs.has(String(i.clubCd)));
      return resp(200, {
        ok: true, action: "beacon_sync_elock", dryRun: true,
        scanned: rows.length, xSkipped, notdSkipped, candidates: items.length, existing: existing.size,
        wouldInsert: newItems.length, useDist: dist,
        existingNotInSource: existingNotInSource.length,
        existingNotInSourceSample: existingNotInSource.slice(0, 15),
        newInNewClubs: newInNewClub.length,
        sample: newItems.slice(0, 15),
      });
    }

    // 新規のみ INSERT (unnest で1往復)。per_use_ticket_rule/indirect_use は触らない。
    if (newItems.length > 0) {
      await elockQuery(
        `insert into club_beacon (machine_id, club_cd, machine_id_type, beacon_use, memo)
         select mid, cc, 0, bu, mm
           from unnest($1::text[], $2::int[], $3::text[], $4::text[]) as t(mid, cc, bu, mm)`,
        [newItems.map((i) => i.machineId), newItems.map((i) => i.clubCd), newItems.map((i) => i.use), newItems.map((i) => i.memo)]
      );
    }
    console.log(`[beacon_sync_elock] scanned=${rows.length} xSkipped=${xSkipped} notdSkipped=${notdSkipped} candidates=${items.length} inserted=${newItems.length}`);
    return resp(200, { ok: true, action: "beacon_sync_elock", scanned: rows.length, xSkipped, notdSkipped, candidates: items.length, inserted: newItems.length, sample: newItems.slice(0, 20) });
  } catch (err) {
    console.error("beacon_sync_elock error", err);
    return resp(500, { error: "internal_error", message: err.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
  }
}

// ── dgtk_app.club_master への Oracleクラブ同期 ──────────────────────────────
// Oracle FIT_ADMIN.クラブ のみ(クラブ情報は手入力で漏れるため不使用) → dgtk_app.club_master。
// club_name=クラブ名(フル), brand=クラブ内の列 or 名称から判定(調査中), prefecture_id=住所1先頭の都道府県→prefecture_master逆引き。
const CLUB_MASTER_SQL = `
  SELECT c.クラブコード AS CLUB_CODE, c.クラブ名 AS CLUB_NAME, c.クラブ略称 AS CLUB_SHORT,
         c.住所1 AS ADDR, c.クラブ区分コード AS KBN, c.店舗タイプ AS TYPE,
         c.識別文字 AS IDC, c.会員番号ヘッダ AS HDR, c.クラブ経営企業コード AS COMP
  FROM FIT_ADMIN.クラブ c
  ORDER BY c.クラブコード
`;

async function sshProxyQuery(target, text, params) {
  const res = await _lambda.send(new InvokeCommand({
    FunctionName: SSH_PROXY_FN,
    Payload: Buffer.from(JSON.stringify({ target, text, params })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload).toString());
  if (!payload || payload.ok !== true) throw new Error(`${target}-proxy: ` + (payload && payload.error ? payload.error : "unknown"));
  return payload.rows || [];
}

async function clubMasterSync({ dryRun = false } = {}) {
  let conn;
  try {
    const pool = await getPool();
    conn = await pool.getConnection();
    const rows = (await conn.execute(CLUB_MASTER_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows || [];
    if (dryRun) {
      // brand判定元の候補列(KBN/TYPE/IDC/HDR)を分布で確認 + 既存club_masterと突合
      const existing = await sshProxyQuery("dgtk_app", `select club_code, brand from dgtk_app.club_master`, []);
      const brandByCode = new Map(existing.map((r) => [String(r.club_code).replace(/\s+$/, ""), (r.brand || "").trim()]));
      const dist = { KBN: {}, TYPE: {}, IDC: {}, HDR: {}, COMP: {} };
      // 各候補列の値ごとに、既存brandの内訳(この列がbrandを決めるなら1対1になるはず)
      const cross = { KBN: {}, TYPE: {}, IDC: {}, HDR: {}, COMP: {} };
      const nameHead = {};
      for (const r of rows) {
        const code6 = String(r.CLUB_CODE).padStart(6, "0");
        const b = brandByCode.get(code6) || "(未登録)";
        for (const k of ["KBN", "TYPE", "IDC", "HDR", "COMP"]) {
          const v = (r[k] == null ? "(null)" : String(r[k]).trim()) || "(空)";
          dist[k][v] = (dist[k][v] || 0) + 1;
          (cross[k][v] = cross[k][v] || {})[b] = (cross[k][v][b] || 0) + 1;
        }
        const nm = (r.CLUB_NAME || "").toString();
        const head = nm.slice(0, 6);
        nameHead[`${head}→${b}`] = (nameHead[`${head}→${b}`] || 0) + 1;
      }
      return resp(200, {
        ok: true, action: "club_master_sync", dryRun: true, scanned: rows.length,
        // どの列が brand と 1対1 になるか(=brand判定元)を見る
        crossKBN: cross.KBN, crossTYPE: cross.TYPE, crossIDC: cross.IDC, crossHDR: cross.HDR, crossCOMP: cross.COMP,
        nameHeadSample: Object.entries(nameHead).slice(0, 20),
        sample: rows.slice(0, 8).map((r) => ({ code: String(r.CLUB_CODE), name: r.CLUB_NAME, kbn: r.KBN, type: r.TYPE, idc: r.IDC, hdr: r.HDR, addr: r.ADDR })),
      });
    }
    return resp(200, { ok: true, action: "club_master_sync", scanned: rows.length, note: "live未実装(先にmapping確定)" });
  } catch (err) {
    console.error("club_master_sync error", err);
    return resp(500, { error: "internal_error", message: err.message });
  } finally {
    if (conn) { try { await conn.close(); } catch (_) {} }
  }
}

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
    p.漢字姓名                                 AS NAME_KANJI,
    p.T連絡先TEL                               AS PHONE,
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
  INNER JOIN FIT_ADMIN.個人 p           ON b.個人SEQ   = p.個人SEQ
  INNER JOIN FIT_ADMIN.会員契約 c       ON a.契約SEQ   = c.契約SEQ
  LEFT  JOIN FIT_ADMIN.会員区分 k       ON c.会員区分コード = k.会員区分コード
  LEFT  JOIN FIT_ADMIN.会費分類 h       ON a.会費分類コード = h.会費分類コード
  LEFT  JOIN latest_account f           ON a.契約者SEQ = f.契約者SEQ
  WHERE b.会員番号 = :memberNo
    AND c.クラブコード = :clubCode
    AND a.対応年月 BETWEEN :fromMonth AND :toMonth
    AND a.入金額 > 0
  ORDER BY a.対応年月 DESC, a.会費分類コード
  FETCH FIRST 200 ROWS ONLY
`;

// --- ターゲット抽出用: 店舗に属する契約種別(会員区分)の母集合 ---
// 退会日は NULL または sentinel '99999999' を在籍中とみなす(未納SQL側の扱いに合わせる)。
const CONTRACT_TYPES_SQL = `
  SELECT
    k.会員区分コード AS CODE,
    k.会員区分名     AS NAME,
    COUNT(*)         AS TOTAL_CNT,
    SUM(CASE WHEN c.退会日 IS NULL OR TO_CHAR(c.退会日) = '99999999' THEN 1 ELSE 0 END) AS ACTIVE_CNT
  FROM FIT_ADMIN.会員契約 c
  INNER JOIN FIT_ADMIN.会員区分 k ON c.会員区分コード = k.会員区分コード
  WHERE c.クラブコード = :clubCode
  GROUP BY k.会員区分コード, k.会員区分名
  ORDER BY ACTIVE_CNT DESC, TOTAL_CNT DESC
  FETCH FIRST 200 ROWS ONLY
`;

// --- ターゲット抽出用: 会員区分に紐づく契約形態(契約形態名)の母集合 ---
// 会員契約 c → 会員契約明細 d → 契約形態 e。会員区分ごとに契約形態を集計する。
const CONTRACT_FORMS_SQL = `
  SELECT
    k.会員区分コード AS PLAN_CODE,
    k.会員区分名     AS PLAN_NAME,
    e.契約形態コード AS FORM_CODE,
    e.契約形態名     AS FORM_NAME,
    COUNT(*)         AS TOTAL_CNT,
    SUM(CASE WHEN c.退会日 IS NULL OR TO_CHAR(c.退会日) = '99999999' THEN 1 ELSE 0 END) AS ACTIVE_CNT
  FROM FIT_ADMIN.会員契約 c
  INNER JOIN FIT_ADMIN.会員区分     k ON c.会員区分コード = k.会員区分コード
  INNER JOIN FIT_ADMIN.会員契約明細 d ON c.契約SEQ       = d.契約SEQ
  INNER JOIN FIT_ADMIN.契約形態     e ON d.契約形態コード = e.契約形態コード
  WHERE c.クラブコード = :clubCode
  GROUP BY k.会員区分コード, k.会員区分名, e.契約形態コード, e.契約形態名
  ORDER BY ACTIVE_CNT DESC, TOTAL_CNT DESC
  FETCH FIRST 300 ROWS ONLY
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
    p.漢字姓名                                 AS NAME_KANJI,
    p.T連絡先TEL                               AS PHONE,
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
  INNER JOIN FIT_ADMIN.個人 p           ON b.個人SEQ   = p.個人SEQ
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

// ===== 未納管理: 振替結果コード が権威 (0=振替成功/入金済, ≠0=振替失敗=未納) =====
// 振替契約別 f を未納の判定元とし、実入金の解消は 会員入金歴 a.入金年月日 で追う。
// join: a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月 (同月対応)。クラブは f.クラブコード。
// 契約×月 単位で返し、会員集計は JS 側 (buildUnpaidFurikae)。
// 未納額 = 単月の純額 = 入会金+年管理費+会費+割引 (割引は負で格納→加算)。
//   ※ 振替金額(合算後)は使わない — 単月debtに合算が混入し過大計上になるため
//     (Lecto連携 未納金額登録SQL の算出方法に準拠)。
// 未納 = 振替結果コード ≠ '0' (CHAR。末尾スペース"0 "のため TRIM。NULL=予定段階は除外)。
// 閾値: 純額の絶対値 > 1 円。
// 入金解消は 会員入金歴 に 入金年月日 が入ったかを NOT EXISTS で判定 (参考SQLには無いが
//   「現在の未納=まだ入金されていない」を表すため付与。入金の記録元は会員入金歴で確認済)。
const UNPAID_NET_EXPR = `(NVL(f.入会金金額,0) + NVL(f.年管理費金額,0) + NVL(f.会費金額,0) + NVL(f.割引金額,0))`;
// クラブは単一(:clubCode)または複数(IN)を clubClause で切替。
const unpaidCurrentBase = (clubClause) => `
  SELECT
    b.会員番号            AS MEMBER_NO,
    p.漢字姓名            AS NAME_KANJI,
    p.カナ姓              AS NAME_KANA_SEI,
    p.カナ名              AS NAME_KANA_MEI,
    p.EMAIL              AS EMAIL,
    p.T連絡先TEL          AS PHONE,
    f.契約SEQ            AS KEIYAKU_SEQ,
    f.クラブコード        AS CLUB_CODE,
    f.振替年月           AS FURIKAE_YM,
    TRIM(f.振替結果コード) AS RESULT_CODE,
    ${UNPAID_NET_EXPR}   AS OUTSTANDING,
    NVL(f.年管理費金額,0) AS ANNUAL_FEE,
    NVL(f.会費金額,0)     AS FEE_AMOUNT,
    k.会員区分名          AS PLAN_NAME,
    c.会員区分コード      AS PLAN_CODE,
    ff.契約形態名         AS FORM_NAME,
    c.退会日             AS WITHDRAWN_DATE,
    c.退会理由コード1     AS WITHDRAW_REASON1,
    -- ⑥ 委託先(JACCS/クレカ等): 当月未納(入金区分4)の会員入金歴から取得
    (SELECT MAX(a2.委託先コード) FROM FIT_ADMIN."会員入金歴" a2
       WHERE a2.契約SEQ = f.契約SEQ AND a2.対応年月 = f.振替年月 AND a2.入金区分コード = 4) AS ICODE,
    -- ③ 現在の入金区分(4=未納/3=入金済/90=売上取消/91=貸倒/...)。全体(cohort)で入金済も把握するため。
    (SELECT MAX(a3.入金区分コード) FROM FIT_ADMIN."会員入金歴" a3
       WHERE a3.契約SEQ = f.契約SEQ AND a3.対応年月 = f.振替年月) AS PAY_KUBUN
  FROM FIT_ADMIN."振替契約別" f
  INNER JOIN FIT_ADMIN."会員番号" b ON f.契約者SEQ = b.契約者SEQ
  INNER JOIN FIT_ADMIN."個人" p     ON b.個人SEQ   = p.個人SEQ
  LEFT  JOIN FIT_ADMIN."会員契約" c ON c.契約SEQ   = f.契約SEQ
  LEFT  JOIN FIT_ADMIN."会員区分" k ON k.会員区分コード = c.会員区分コード
  LEFT  JOIN FIT_ADMIN."契約形態" ff ON ff.契約形態コード = f.契約形態コード
  WHERE ${clubClause}
    AND f.振替年月 >= :fromYm
    AND TRIM(f.振替結果コード) <> '0'
    AND ABS(${UNPAID_NET_EXPR}) > 1`;

// 現行未納の権威判定: 会員入金歴.入金区分コード = 4(未納)。
const CURRENT_UNPAID_EXISTS = `
    AND EXISTS (
      SELECT 1 FROM FIT_ADMIN."会員入金歴" a
       WHERE a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月
         AND a.入金区分コード = 4
    )`;

// ① 現在の未納 (貸倒予定=強制退会 は除外)。入金区分4(未納)のみ。
const unpaidCurrentSql = (clubClause) => unpaidCurrentBase(clubClause) + CURRENT_UNPAID_EXISTS + `
    AND (c.退会理由コード1 IS NULL OR TRIM(TO_CHAR(c.退会理由コード1)) <> :forcedReason)
  ORDER BY f.振替年月 ASC
  FETCH FIRST 20000 ROWS ONLY
`;
// ③ 貸倒予定 (過去強制退会で請求が継続している人)
const unpaidWriteoffSql = (clubClause) => unpaidCurrentBase(clubClause) + CURRENT_UNPAID_EXISTS + `
    AND TRIM(TO_CHAR(c.退会理由コード1)) = :forcedReason
  ORDER BY f.振替年月 ASC
  FETCH FIRST 20000 ROWS ONLY
`;
// ③(全体/確定時点) 初回振替が失敗した人の全体。入金区分4フィルタ無し=既にアプリ入金済も残す。
// 各行に現在の入金区分(PAY_KUBUN)を付与し、会員単位で「未納/一部入金/入金済」を判定する。
// 振替結果コードは後から変わらないため、支払われても人数が減らない(=消えない全体)。
const unpaidCohortSql = (clubClause) => unpaidCurrentBase(clubClause) + `
    AND (c.退会理由コード1 IS NULL OR TRIM(TO_CHAR(c.退会理由コード1)) <> :forcedReason)
  ORDER BY f.振替年月 ASC
  FETCH FIRST 40000 ROWS ONLY
`;
// ② 未納 → いつ入金されたか (振替失敗だが後で入金あり)。入金明細は会員入金歴側。
const UNPAID_PAID_SQL = `
  SELECT
    b.会員番号            AS MEMBER_NO,
    p.漢字姓名            AS NAME_KANJI,
    f.契約SEQ            AS KEIYAKU_SEQ,
    f.振替年月           AS FURIKAE_YM,
    f.振替金額           AS FURIKAE_AMOUNT,
    a.請求額             AS BILLED_AMOUNT,
    a.入金額             AS PAID_AMOUNT,
    a.請求年月日         AS BILLED_DATE,
    a.入金年月日         AS PAID_DATE
  FROM FIT_ADMIN."振替契約別" f
  INNER JOIN FIT_ADMIN."会員入金歴" a
        ON a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月 AND a.入金年月日 IS NOT NULL
  INNER JOIN FIT_ADMIN."会員番号" b ON f.契約者SEQ = b.契約者SEQ
  INNER JOIN FIT_ADMIN."個人" p     ON b.個人SEQ   = p.個人SEQ
  WHERE f.クラブコード = :clubCode
    AND TRIM(f.振替結果コード) <> '0'
    AND a.入金年月日 >= :fromYmd
  ORDER BY a.入金年月日 DESC
  FETCH FIRST 20000 ROWS ONLY
`;

// ダッシュボード全体数値: クラブ(複数可)×振替年月 を 請求/回収/未納 に集計。
// 請求 = 全振替(結果コード≠NULL, 純額>1) / 回収 = 結果='0' / 未納 = 結果≠'0'。
// 件数は振替の総数(COUNT)。各振替は 回収 or 未納 のいずれかなので 請求=回収+未納 が一致する。
//   GROUPING SETS で 月別((振替年月)) と 期間合計(()) を1クエリで取得。
function unpaidSummarySql(clubBindNames) {
  // 強制退会(退会理由コード1=:forcedReason=貸倒予定)を除いた集計(_X)も同時に返す。
  const NOT_FORCED = `(c.退会理由コード1 IS NULL OR TRIM(TO_CHAR(c.退会理由コード1)) <> :forcedReason)`;
  return `
  SELECT
    f.振替年月 AS YM,
    GROUPING(f.振替年月) AS IS_TOTAL,
    COUNT(*) AS BILLED_CNT,
    SUM(${UNPAID_NET_EXPR}) AS BILLED_AMT,
    COUNT(CASE WHEN TRIM(f.振替結果コード) = '0' THEN 1 END) AS COLLECTED_CNT,
    SUM(CASE WHEN TRIM(f.振替結果コード) = '0' THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS COLLECTED_AMT,
    COUNT(CASE WHEN TRIM(f.振替結果コード) <> '0' THEN 1 END) AS UNPAID_CNT,
    SUM(CASE WHEN TRIM(f.振替結果コード) <> '0' THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS UNPAID_AMT,
    COUNT(CASE WHEN ${NOT_FORCED} THEN 1 END) AS BILLED_CNT_X,
    SUM(CASE WHEN ${NOT_FORCED} THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS BILLED_AMT_X,
    COUNT(CASE WHEN ${NOT_FORCED} AND TRIM(f.振替結果コード) = '0' THEN 1 END) AS COLLECTED_CNT_X,
    SUM(CASE WHEN ${NOT_FORCED} AND TRIM(f.振替結果コード) = '0' THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS COLLECTED_AMT_X,
    COUNT(CASE WHEN ${NOT_FORCED} AND TRIM(f.振替結果コード) <> '0' THEN 1 END) AS UNPAID_CNT_X,
    SUM(CASE WHEN ${NOT_FORCED} AND TRIM(f.振替結果コード) <> '0' THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS UNPAID_AMT_X
  FROM FIT_ADMIN."振替契約別" f
  LEFT JOIN FIT_ADMIN."会員契約" c ON c.契約SEQ = f.契約SEQ
  WHERE f.クラブコード IN (${clubBindNames.join(",")})
    AND f.振替年月 BETWEEN :fromYm AND :toYm
    AND f.振替結果コード IS NOT NULL
    AND ABS(${UNPAID_NET_EXPR}) > 1
  GROUP BY GROUPING SETS ((f.振替年月), ())
  ORDER BY f.振替年月`;
}

function buildUnpaidSummary(rows) {
  const byMonth = [];
  let tot = null;
  const N = (v) => Number(v) || 0;
  for (const r of rows) {
    const rec = {
      billedCount: N(r.BILLED_CNT), billedAmount: N(r.BILLED_AMT),
      collectedCount: N(r.COLLECTED_CNT), collectedAmount: N(r.COLLECTED_AMT),
      unpaidCount: N(r.UNPAID_CNT), unpaidAmount: N(r.UNPAID_AMT),
      // 強制退会(貸倒予定)を除く
      billedCountX: N(r.BILLED_CNT_X), billedAmountX: N(r.BILLED_AMT_X),
      collectedCountX: N(r.COLLECTED_CNT_X), collectedAmountX: N(r.COLLECTED_AMT_X),
      unpaidCountX: N(r.UNPAID_CNT_X), unpaidAmountX: N(r.UNPAID_AMT_X),
    };
    if (Number(r.IS_TOTAL) === 1) {
      tot = rec;
    } else {
      const ym = r.YM != null ? String(r.YM) : "";
      const month = ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4, 6)}` : ym;
      byMonth.push({ month, ...rec });
    }
  }
  const z = { billedCount: 0, billedAmount: 0, collectedCount: 0, collectedAmount: 0, unpaidCount: 0, unpaidAmount: 0, billedCountX: 0, billedAmountX: 0, collectedCountX: 0, collectedAmountX: 0, unpaidCountX: 0, unpaidAmountX: 0 };
  const t = tot || z;
  const rate = (col, un) => (col + un > 0 ? Math.round((col / (col + un)) * 100) : 0);
  return {
    ...t,
    collectionRate: rate(t.collectedAmount, t.unpaidAmount),
    collectionRateX: rate(t.collectedAmountX, t.unpaidAmountX),
    byMonth: byMonth.sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}

// ダッシュボード②: 「初回振替が失敗した人(=未納になった人)」のその後の入金状況。
// 振替系(振替契約別)で初回振替が不成立(振替結果≠0)だった分を、入金系(会員入金歴)の
// 入金区分コードで追跡する。1=支払義務無し/2=未請求/3=支払済/4=未納/90=売上取消/91=貸倒れ。
// 入金歴が無い分(初回振替直後で未処理)は KUBUN=0 として集計。
function unpaidFollowupSql(clubBindNames) {
  return `
  SELECT f.振替年月 AS YM,
         GROUPING(f.振替年月) AS IS_TOTAL,
         NVL(a.入金区分コード, 0) AS KUBUN,
         COUNT(DISTINCT f.契約者SEQ) AS CNT,
         SUM(NVL(a.請求額, 0)) AS BILLED_AMT,
         SUM(NVL(a.入金額, 0)) AS PAID_AMT,
         SUM(CASE WHEN a.入金区分コード IS NULL THEN ${UNPAID_NET_EXPR} ELSE 0 END) AS NOENTRY_NET
  FROM FIT_ADMIN."振替契約別" f
  LEFT JOIN FIT_ADMIN."会員入金歴" a ON a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月
  WHERE f.クラブコード IN (${clubBindNames.join(",")})
    AND f.振替年月 BETWEEN :fromYm AND :toYm
    AND TRIM(f.振替結果コード) <> '0'
    AND ABS(${UNPAID_NET_EXPR}) > 1
  GROUP BY GROUPING SETS ((f.振替年月, NVL(a.入金区分コード, 0)), (NVL(a.入金区分コード, 0)))
  ORDER BY YM, KUBUN`;
}

function buildUnpaidFollowup(rows) {
  const LABELS = { 0: "未処理", 1: "支払義務無し", 2: "未請求", 3: "支払済", 4: "未納", 90: "売上取消", 91: "貸倒れ" };
  const amtOf = (r) => { const k = Number(r.KUBUN); return k === 0 ? (Number(r.NOENTRY_NET) || 0) : (Number(r.BILLED_AMT) || 0); };
  const buckets = {};                 // 期間合計 (IS_TOTAL=1)
  const monthMap = new Map();         // ym -> { recovered, stillUnpaid, pending, writeoff, cancelled }
  for (const r of rows) {
    const k = Number(r.KUBUN);
    const amt = amtOf(r);
    if (Number(r.IS_TOTAL) === 1) {
      buckets[k] = { kubun: k, label: LABELS[k] || `区分${k}`, count: Number(r.CNT) || 0, billedAmount: Number(r.BILLED_AMT) || 0, paidAmount: Number(r.PAID_AMT) || 0, amount: amt };
    } else {
      const ymRaw = r.YM != null ? String(r.YM) : "";
      const month = ymRaw.length === 6 ? `${ymRaw.slice(0, 4)}-${ymRaw.slice(4, 6)}` : ymRaw;
      if (!month) continue;
      let m = monthMap.get(month);
      if (!m) { m = { recoveredAmount: 0, stillUnpaidAmount: 0, pendingAmount: 0, writeoffAmount: 0, cancelledAmount: 0 }; monthMap.set(month, m); }
      if (k === 3) m.recoveredAmount += amt;        // 後日回収(支払済)
      else if (k === 4) m.stillUnpaidAmount += amt; // 現未納
      else if (k === 0) m.pendingAmount += amt;     // 未処理
      else if (k === 91) m.writeoffAmount += amt;   // 貸倒れ
      else if (k === 90) m.cancelledAmount += amt;  // 売上取消
    }
  }
  const g = (k) => buckets[k] || { kubun: k, label: LABELS[k], count: 0, billedAmount: 0, paidAmount: 0, amount: 0 };
  return {
    paid: g(3), unpaid: g(4), writeoff: g(91), cancelled: g(90), noObligation: g(1), notBilled: g(2), pending: g(0),
    all: Object.values(buckets).sort((a, b) => a.kubun - b.kubun),
    byMonth: monthMap, // 月別の後日回収/現未納 (handler で summary.byMonth へマージ)
  };
}

// 貸倒償却予定: 貸倒予定(強制退会)の未納を 振替年月 で集計。
// 償却予定月 = 振替年月 + 12ヶ月 (1年後に貸し倒れ償却) として月次・年度(4月始まり)で集計。
function writeoffScheduleSql(clubBindNames) {
  return `
  SELECT f.振替年月 AS YM, COUNT(*) AS CNT, SUM(${UNPAID_NET_EXPR}) AS AMT
  FROM FIT_ADMIN."振替契約別" f
  LEFT JOIN FIT_ADMIN."会員契約" c ON c.契約SEQ = f.契約SEQ
  WHERE f.クラブコード IN (${clubBindNames.join(",")})
    AND TRIM(TO_CHAR(c.退会理由コード1)) = :forcedReason
    AND TRIM(f.振替結果コード) <> '0'
    AND ABS(${UNPAID_NET_EXPR}) > 1
    AND NOT EXISTS (
      SELECT 1 FROM FIT_ADMIN."会員入金歴" a
       WHERE a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月 AND a.入金年月日 IS NOT NULL
    )
  GROUP BY f.振替年月
  ORDER BY f.振替年月`;
}
function _addMonthsYm(ym, add) {
  const y = Math.floor(ym / 100), m = ym % 100;
  const t = y * 12 + (m - 1) + add;
  return Math.floor(t / 12) * 100 + (t % 12) + 1;
}
function _fiscalYear(ym) { const y = Math.floor(ym / 100), m = ym % 100; return m >= 4 ? y : y - 1; }
function buildWriteoffSchedule(rows) {
  const monthMap = new Map();
  const fyMap = new Map();
  let totalAmount = 0, totalCount = 0;
  for (const r of rows) {
    const ym = Number(r.YM);
    if (!ym) continue;
    const cnt = Number(r.CNT) || 0, amt = Number(r.AMT) || 0;
    const sched = _addMonthsYm(ym, 12); // 償却予定 = 振替年月 + 12ヶ月
    const sm = `${Math.floor(sched / 100)}-${String(sched % 100).padStart(2, "0")}`;
    const m = monthMap.get(sm) || { month: sm, count: 0, amount: 0 };
    m.count += cnt; m.amount += amt; monthMap.set(sm, m);
    const fy = _fiscalYear(sched);
    const f = fyMap.get(fy) || { fiscalYear: fy, count: 0, amount: 0 };
    f.count += cnt; f.amount += amt; fyMap.set(fy, f);
    totalAmount += amt; totalCount += cnt;
  }
  return {
    byMonth: [...monthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    byFiscalYear: [...fyMap.values()].sort((a, b) => a.fiscalYear - b.fiscalYear).map((x) => ({ ...x, label: `${x.fiscalYear}年度` })),
    totalAmount, totalCount,
  };
}

function _fmtYmd(raw) { const s = raw != null ? String(raw) : ""; return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : null; }
function _fmtYm(raw) { const s = raw != null ? String(raw) : ""; return s.length === 6 ? `${s.slice(0,4)}-${s.slice(4,6)}` : s; }

// ⑥ 委託先コード → 名称 / 区分(JACCS・クレカ等)。会員入金歴.委託先コード に準拠。
const CONSIGN_NAME = { 0: "現金", 1: "SMBCクレジット", 2: "JACCS収金代行", 3: "オリコ", 4: "りそな", 5: "ｿﾌﾄﾊﾞﾝｸ", 6: "JACCS(FIT)", 7: "GMO", 9: "ＦＤ自振", 88: "JACCS集金代行", 89: "JACCSクレジット", 90: "現金", 99: "振込" };
function consignCategory(code) {
  if ([2, 6, 88, 89].includes(code)) return "JACCS";       // 口座振替(JACCS各種)
  if ([1, 3, 5, 7].includes(code)) return "クレカ";         // クレジット/収納代行(SMBC/オリコ/ｿﾌﾄﾊﾞﾝｸ/GMO)
  if ([0, 90].includes(code)) return "現金";
  if (code === 99) return "振込";
  if (code === 9) return "自振";
  if (code === 4) return "りそな";
  return "その他";
}

// 振替未納の明細行 → 正規化 + 会員集計
function buildUnpaidFurikae(type, rows) {
  // ② いつ入金されたか: 会員入金歴の入金明細 (滞留日数つき)
  if (type === "unpaid_paid") {
    const items = rows.map((r) => {
      const billedDate = _fmtYmd(r.BILLED_DATE);
      const paidDate = _fmtYmd(r.PAID_DATE);
      return {
        memberNo: r.MEMBER_NO != null ? String(r.MEMBER_NO) : null,
        memberName: r.NAME_KANJI != null ? String(r.NAME_KANJI) : null,
        contractSeq: r.KEIYAKU_SEQ != null ? Number(r.KEIYAKU_SEQ) : null,
        furikaeMonth: _fmtYm(r.FURIKAE_YM),
        furikaeAmount: Number(r.FURIKAE_AMOUNT) || 0,
        billedAmount: Number(r.BILLED_AMOUNT) || 0,
        paidAmount: Number(r.PAID_AMOUNT) || 0,
        billedDate,
        paidDate,
        daysToPay: billedDate && paidDate
          ? Math.max(0, Math.round((new Date(paidDate).getTime() - new Date(billedDate).getTime()) / 86400000))
          : null,
      };
    });
    return { items };
  }

  // ① 現在の未納 / ③ 貸し倒れ候補: 未納額 = 単月純額。会員単位で集計。
  const items = rows.map((r) => ({
    memberNo: r.MEMBER_NO != null ? String(r.MEMBER_NO) : null,
    memberName: r.NAME_KANJI != null ? String(r.NAME_KANJI) : null,
    kana: [r.NAME_KANA_SEI, r.NAME_KANA_MEI].filter(Boolean).join(" ").trim() || null,
    email: r.EMAIL != null ? String(r.EMAIL).trim() || null : null,
    phone: r.PHONE != null ? String(r.PHONE).trim() || null : null,
    contractSeq: r.KEIYAKU_SEQ != null ? Number(r.KEIYAKU_SEQ) : null,
    clubCode: r.CLUB_CODE != null ? String(r.CLUB_CODE) : null,
    furikaeMonth: _fmtYm(r.FURIKAE_YM),
    resultCode: r.RESULT_CODE != null ? String(r.RESULT_CODE).trim() : null,
    outstanding: Number(r.OUTSTANDING) || 0,
    annualFee: Number(r.ANNUAL_FEE) || 0,        // ⑦ FIT365 セキュリティ費 = 年管理費
    feeAmount: Number(r.FEE_AMOUNT) || 0,        // 会費金額
    plan: r.PLAN_NAME ?? null,                    // ① 会員区分(会員区分名)
    planCode: r.PLAN_CODE != null ? Number(r.PLAN_CODE) : null, // 会員区分コード(1=会費/基本)
    formName: r.FORM_NAME != null ? String(r.FORM_NAME).trim() || null : null, // 契約形態名
    // 退会日 99999999 は未退会(現役)のセンチネル → null 扱い
    withdrawnDate: (r.WITHDRAWN_DATE != null && String(r.WITHDRAWN_DATE).trim() !== "" && String(r.WITHDRAWN_DATE).trim() !== "99999999") ? String(r.WITHDRAWN_DATE).trim() : null,
    withdrawReason1: r.WITHDRAW_REASON1 != null ? String(r.WITHDRAW_REASON1).trim() : null,
    forced: r.WITHDRAW_REASON1 != null && String(r.WITHDRAW_REASON1).trim() === "42", // 強制退会(暫定)
    consignCode: r.ICODE != null ? Number(r.ICODE) : null, // ⑥ 委託先コード
    payKubun: r.PAY_KUBUN != null ? Number(r.PAY_KUBUN) : null, // 現在の入金区分(4=未納/3=入金済/…)
  }));

  const byMember = new Map();
  for (const it of items) {
    const key = it.memberNo || "";
    let m = byMember.get(key);
    if (!m) {
      m = {
        memberNo: it.memberNo, memberName: it.memberName, kana: it.kana, email: it.email, phone: it.phone,
        clubCode: it.clubCode, plan: it.plan,
        baseFormName: null, // 会員区分1(基本会費)の契約形態名
        unpaidCount: 0, outstanding: 0, annualFeeTotal: 0,
        oldestMonth: it.furikaeMonth, latestMonth: it.furikaeMonth,
        withdrawn: false, forced: false, withdrawReason1: null,
        stillUnpaidAmount: 0, _payStill: 0, _payPaid: 0, // ③ 現在の入金状況(全体モードで使用)
        _contracts: new Set(), _months: new Map(), _forms: new Map(), _consign: new Set(),
      };
      byMember.set(key, m);
    }
    m.unpaidCount += 1;
    m.outstanding += it.outstanding;
    m.annualFeeTotal += it.annualFee;
    if (it.furikaeMonth && (!m.oldestMonth || it.furikaeMonth < m.oldestMonth)) m.oldestMonth = it.furikaeMonth;
    if (it.furikaeMonth && (!m.latestMonth || it.furikaeMonth > m.latestMonth)) { m.latestMonth = it.furikaeMonth; if (it.plan) m.plan = it.plan; }
    if (it.withdrawnDate) m.withdrawn = true;
    if (it.forced) { m.forced = true; m.withdrawReason1 = it.withdrawReason1; }
    if (it.contractSeq != null) m._contracts.add(it.contractSeq);
    if (it.consignCode != null) m._consign.add(it.consignCode); // ⑥ 委託先
    // ③ 現在の入金区分で「まだ未納 / もう入金済」を仕分け
    if (it.payKubun === 4) { m._payStill += 1; m.stillUnpaidAmount += it.outstanding; }
    else if (it.payKubun === 3) { m._payPaid += 1; }
    // 月別内訳 (振替年月ごとに純額を合算)
    if (it.furikaeMonth) m._months.set(it.furikaeMonth, (m._months.get(it.furikaeMonth) || 0) + it.outstanding);
    // 会員区分1(基本会費)の契約形態名を会員区分列に使う
    if (it.planCode === 1 && it.formName && !m.baseFormName) m.baseFormName = it.formName;
    // 契約形態名別の内訳 (会費金額・未納純額を合算)。基本会費(区分1)＋オプション(区分90等)を分けて表示する。
    const fkey = it.formName || it.plan || "その他";
    let fb = m._forms.get(fkey);
    if (!fb) { fb = { formName: it.formName || it.plan || "その他", planCode: it.planCode, isBase: it.planCode === 1, feeAmount: 0, outstanding: 0 }; m._forms.set(fkey, fb); }
    fb.feeAmount += it.feeAmount; fb.outstanding += it.outstanding;
  }
  const members = [...byMember.values()]
    .map((m) => {
      const { _contracts, _months, _forms, _consign, _payStill, _payPaid, ...rest } = m;
      rest.contractCount = _contracts.size;
      // ③ 現在の支払状況: 未納が残る / 一部入金 / 入金済(全体モードで意味を持つ)
      rest.stillUnpaid = _payStill > 0;
      rest.paymentStatus = _payStill > 0 ? (_payPaid > 0 ? "一部入金" : "未納") : (_payPaid > 0 ? "入金済" : "処理中");
      // ⑥ 委託先(JACCS/クレカ等): コード配列・名称配列・区分(複数なら「/」連結)
      const consignCodes = [..._consign].sort((a, b) => a - b);
      rest.consignCodes = consignCodes;
      rest.consignments = consignCodes.map((c) => CONSIGN_NAME[c] || `委託先${c}`);
      rest.consignCategory = [...new Set(consignCodes.map(consignCategory))].join("/") || null;
      // 会員区分列: 会員区分1(基本会費)の契約形態名。無ければ従来の会員区分名にフォールバック。
      rest.plan = m.baseFormName || m.plan || null;
      // 月別内訳: 新しい順 (④ 1か月目/2か月目…)
      rest.monthlyBreakdown = [..._months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, amount]) => ({ month, amount }));
      // 契約形態別内訳: 基本会費(区分1)を先頭、以降オプションを金額降順。会費金額を主に表示。
      rest.formBreakdown = [..._forms.values()].sort((a, b) => (b.isBase ? 1 : 0) - (a.isBase ? 1 : 0) || b.feeAmount - a.feeAmount);
      rest.unpaidMonths = _months.size; // 未納月数
      // ② ステータス: 過去強制退会(退会理由コード=42・暫定)→貸倒予定 / それ以外は未納月数
      rest.status = m.forced ? "貸倒予定" : `${_months.size}か月目`;
      rest.hasSecurityFee = rest.annualFeeTotal > 0; // ⑦
      return rest;
    })
    // 未納者の抽出基準: 会員合計の絶対値 > 1円 (Lecto連携 債務者登録SQL に統一)
    .filter((m) => Math.abs(m.outstanding) > 1)
    .sort((a, b) => b.outstanding - a.outstanding);
  return { members, items, totalOutstanding: members.reduce((s, m) => s + m.outstanding, 0), totalMembers: members.length };
}

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
  // EventBridge 直接起動: ビーコン日次同期
  if (event?.action === "beacon_sync") return beaconSync();
  if (event?.action === "beacon_sync_elock") return beaconSyncElock({ dryRun: event?.dryRun === true });
  if (event?.action === "club_master_sync") return clubMasterSync({ dryRun: event?.dryRun === true });
  // 分析用: 読み取り専用SQL(直接invoke限定=API GW非公開。SELECT/WITHのみ)。KNOWBIE_RO権限。
  if (event?.action === "sql" && typeof event.text === "string") {
    if (!/^\s*(select|with)\b/i.test(event.text)) return resp(400, { error: "read-only: SELECT/WITH only" });
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(event.text, event.binds || {}, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: event.maxRows || 5000 });
      return resp(200, { ok: true, count: (r.rows || []).length, rows: r.rows || [] });
    } catch (e) { return resp(500, { error: e.message }); }
    finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }
  const params = event?.queryStringParameters || {};
  const type = params.type;
  const q = normalize(type, params.q);
  const q2 = params.q2 ? normalize(type, params.q2) : null;

  // 公開API用: クラブの「最新の契約できる契約形態」(直近入会で使われている契約形態=マスタ情報)。
  // 契約形態マスタはクラブ非依存のため、直近sinceMonthsヶ月に入会した会員(区分1/7/70)の契約形態から導出。
  if (type === "club-contracts") {
    const clubCode = parseInt(String(params.clubCode || "").trim(), 10);
    if (!clubCode) return resp(400, { error: "missing_params", required: ["clubCode"] });
    const months = Math.min(60, Math.max(1, parseInt(params.sinceMonths || "12", 10) || 12));
    const nd = new Date();
    const sd = new Date(nd.getFullYear(), nd.getMonth() - months, nd.getDate());
    const since = sd.getFullYear() * 10000 + (sd.getMonth() + 1) * 100 + sd.getDate();
    const sql = `SELECT d.契約形態コード AS CODE, e.契約形態名 AS NAME, e.会員区分コード AS KUBUN,
        e.有効期限 AS TERM, e.スクールフラグ AS SCHOOL_FLAG, e.グループ割引可能フラグ AS GROUP_DISCOUNT_FLAG,
        e.休会可能フラグ AS PAUSABLE_FLAG, e.月間利用可能回数 AS MONTHLY_USES, e.年間利用可能回数 AS YEARLY_USES,
        e.保証金商品コード AS DEPOSIT_PID, e.入会金商品コード AS ENROLL_PID, e.事務手続料金商品コード AS ADMIN_FEE_PID,
        e.会費商品コード AS FEE_PID, e.年管理費商品コード AS ANNUAL_FEE_PID, e.ソートNO AS SORT_NO,
        COUNT(DISTINCT c.契約SEQ) AS RECENT_COUNT, TO_CHAR(MAX(c.入会届出日)) AS LATEST_JOIN
      FROM FIT_ADMIN.会員契約 c
      JOIN FIT_ADMIN.会員契約明細 d ON c.契約SEQ = d.契約SEQ
      LEFT JOIN FIT_ADMIN.契約形態 e ON d.契約形態コード = e.契約形態コード
      WHERE c.クラブコード = :club AND c.会員区分コード IN (1,7,70) AND c.入会届出日 >= :since
      GROUP BY d.契約形態コード, e.契約形態名, e.会員区分コード, e.有効期限, e.スクールフラグ,
        e.グループ割引可能フラグ, e.休会可能フラグ, e.月間利用可能回数, e.年間利用可能回数,
        e.保証金商品コード, e.入会金商品コード, e.事務手続料金商品コード, e.会費商品コード, e.年管理費商品コード, e.ソートNO
      ORDER BY RECENT_COUNT DESC`;
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, { club: clubCode, since }, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 200 });
      return resp(200, { ok: true, clubCode, sinceMonths: months, count: (r.rows || []).length, contracts: r.rows || [] });
    } catch (e) { return resp(500, { error: e.message }); }
    finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // 公開API用: クラブ別の契約会費金額(適用年月付き)。
  // 粒度 = (契約形態コード × 会費適用区分コード × 適用人数) ごとに 適用年月 の改定履歴を持つ。
  //  既定       : 各キーの最新(適用年月が最大)のみ。isLatest 判定用に MAX_YYYYMM も返す。
  //  history=1  : 全ての適用年月(改定履歴)を返す。
  //  asOf=YYYYMM: その年月時点で有効な会費(=適用年月 <= asOf の中の最新)。
  if (type === "club-fees") {
    const clubCode = parseInt(String(params.clubCode || "").trim(), 10);
    if (!clubCode) return resp(400, { error: "missing_params", required: ["clubCode"] });
    const history = /^(1|true|yes)$/i.test(String(params.history || ""));
    const asOfRaw = String(params.asOf || "").trim();
    const asOf = /^\d{6}$/.test(asOfRaw) ? parseInt(asOfRaw, 10) : null;
    const binds = { club: clubCode };
    let where = "t.クラブコード = :club";
    if (asOf != null) { where += " AND t.適用年月 <= :asOf"; binds.asOf = asOf; }
    const sql = `
      SELECT * FROM (
        SELECT t.クラブコード AS CLUB_CODE, t.契約形態コード AS FORM_CODE, e.契約形態名 AS FORM_NAME,
               t.会費適用区分コード AS FEE_APPLY_KUBUN, t.適用人数 AS APPLY_HEADCOUNT, t.適用年月 AS APPLY_YYYYMM,
               t.入会金 AS ENROLLMENT_FEE, t.事務手続料金 AS ADMIN_FEE, t.月会費 AS MONTHLY_FEE,
               ROW_NUMBER() OVER (PARTITION BY t.契約形態コード, t.会費適用区分コード, t.適用人数 ORDER BY t.適用年月 DESC) AS RN,
               MAX(t.適用年月) OVER (PARTITION BY t.契約形態コード, t.会費適用区分コード, t.適用人数) AS MAX_YYYYMM
        FROM FIT_ADMIN.契約会費金額 t
        LEFT JOIN FIT_ADMIN.契約形態 e ON e.契約形態コード = t.契約形態コード
        WHERE ${where}
      ) ${history ? "" : "WHERE RN = 1"}
      ORDER BY FORM_CODE, FEE_APPLY_KUBUN, APPLY_HEADCOUNT, APPLY_YYYYMM DESC`;
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: history ? 20000 : 3000 });
      return resp(200, { ok: true, clubCode, asOf, history, count: (r.rows || []).length, fees: r.rows || [] });
    } catch (e) { return resp(500, { error: e.message }); }
    finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // 公開API用: クラブ一覧(クラブ情報)。閉店店舗も含む(閉店フラグ付き)。
  // 業態(赤/FIT365/青/緑…)からブランドはAPI側で正規化。
  // 経営企業コード=FIT_ADMIN.クラブ.クラブ経営企業コード(COMP)、企業名=クラブ情報.企業名(COMPNAME)。
  //   ※ クラブ情報 には経営企業「コード」が無いため FIT_ADMIN.クラブ を LEFT JOIN して補う(ro権限あり)。
  // formCodes 指定時は「その契約形態(主契約)を扱う店舗」に絞り、matchedFormCodes(FORMS)を付与。
  if (type === "clubs-list") {
    // formCodes は配列 or カンマ区切り文字列。整数のみ採用。
    const rawForms = params.formCodes;
    const formCodes = (Array.isArray(rawForms) ? rawForms : String(rawForms || "").split(","))
      .map((x) => parseInt(String(x).trim(), 10))
      .filter((n) => Number.isFinite(n));
    const formMatch = /^all$/i.test(String(params.formMatch || "")) ? "all" : "any";

    let sql;
    const binds = {};
    if (formCodes.length) {
      const inList = formCodes.map((_, i) => `:f${i}`).join(",");
      formCodes.forEach((c, i) => { binds[`f${i}`] = c; });
      // 内側で (クラブ×契約形態) を DISTINCT 化してから集約(LISTAGG DISTINCT非依存で互換性重視)。
      // ALL: 指定コード数と一致する店舗のみ。ANY: 1つでも該当すれば対象。
      const having = formMatch === "all" ? `HAVING COUNT(*) = ${formCodes.length}` : "";
      sql = `
        SELECT ci.クラブコード AS CODE, ci.クラブ名 AS NAME, ci.業態 AS GYOTAI, ci.閉店フラグ AS CLOSED,
               ci.企業名 AS COMPNAME, c.クラブ経営企業コード AS COMP, m.FORMS AS FORMS
        FROM FIT_ADMIN.クラブ情報 ci
        LEFT JOIN FIT_ADMIN.クラブ c ON ci.クラブコード = c.クラブコード
        INNER JOIN (
          SELECT クラブコード,
                 LISTAGG(契約形態コード, ',') WITHIN GROUP (ORDER BY 契約形態コード) AS FORMS,
                 COUNT(*) AS NFORMS
          FROM (
            SELECT DISTINCT クラブコード, 契約形態コード
            FROM FIT_ADMIN.契約会費金額
            WHERE 契約形態コード IN (${inList})
          )
          GROUP BY クラブコード
          ${having}
        ) m ON m.クラブコード = ci.クラブコード
        ORDER BY ci.クラブコード`;
    } else {
      sql = `SELECT ci.クラブコード AS CODE, ci.クラブ名 AS NAME, ci.業態 AS GYOTAI, ci.閉店フラグ AS CLOSED,
               ci.企業名 AS COMPNAME, c.クラブ経営企業コード AS COMP
        FROM FIT_ADMIN.クラブ情報 ci
        LEFT JOIN FIT_ADMIN.クラブ c ON ci.クラブコード = c.クラブコード
        ORDER BY ci.クラブコード`;
    }
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 2000 });
      return resp(200, {
        ok: true,
        count: (r.rows || []).length,
        formCodes: formCodes.length ? formCodes : undefined,
        formMatch: formCodes.length ? formMatch : undefined,
        clubs: r.rows || [],
      });
    } catch (e) { return resp(500, { error: e.message }); }
    finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

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

  // 未納管理 貸倒償却予定 (年度別・月別。償却予定=振替年月+12ヶ月)
  if (type === "unpaid_writeoff_schedule") {
    const clubs = (params.clubCodes || params.clubCode || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    if (clubs.length === 0) return resp(400, { error: "missing_params", required: ["clubCode or clubCodes"] });
    const forcedReason = (params.forcedReason || "42").trim();
    const clubBindNames = clubs.map((_, i) => `:club${i}`);
    const binds = { forcedReason };
    clubs.forEach((c, i) => { binds[`club${i}`] = c; });
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(writeoffScheduleSql(clubBindNames), binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return resp(200, buildWriteoffSchedule(r.rows || []));
    } catch (err) {
      console.error("unpaid_writeoff_schedule error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // 月次ドリルダウン: 指定月の 未納者(入金区分4) と 回収者(初回振替失敗→支払済 区分3) を返す。
  if (type === "unpaid_month_detail") {
    const clubs = (params.clubCodes || params.clubCode || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    const ymP = Number(params.ym || 0);
    if (clubs.length === 0 || !ymP) return resp(400, { error: "missing_params", required: ["clubCode(s)", "ym"] });
    const cb = clubs.map((_, i) => `:club${i}`);
    const binds = { ym: ymP };
    clubs.forEach((c, i) => { binds[`club${i}`] = c; });
    const sql = `
      SELECT b.会員番号 AS MEMBER_NO, p.漢字姓名 AS NAME, p.T連絡先TEL AS PHONE, p.EMAIL AS EMAIL,
             NVL(a.入金区分コード, 0) AS KUBUN,
             SUM(${UNPAID_NET_EXPR}) AS AMT
      FROM FIT_ADMIN."振替契約別" f
      JOIN FIT_ADMIN."会員番号" b ON f.契約者SEQ = b.契約者SEQ
      JOIN FIT_ADMIN."個人" p ON b.個人SEQ = p.個人SEQ
      LEFT JOIN FIT_ADMIN."会員入金歴" a ON a.契約SEQ = f.契約SEQ AND a.対応年月 = f.振替年月
      WHERE f.クラブコード IN (${cb.join(",")}) AND f.振替年月 = :ym
        AND TRIM(f.振替結果コード) <> '0' AND ABS(${UNPAID_NET_EXPR}) > 1
      GROUP BY b.会員番号, p.漢字姓名, p.T連絡先TEL, p.EMAIL, NVL(a.入金区分コード, 0)`;
    let conn;
    try {
      const pool = await getPool(); conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      // 会員単位に集約: 区分4=未納 / 区分3=後日回収
      const mem = new Map();
      for (const x of r.rows || []) {
        const no = String(x.MEMBER_NO);
        let m = mem.get(no);
        if (!m) { m = { memberNo: no, name: x.NAME || "", phone: x.PHONE || "", email: x.EMAIL || "", unpaidAmount: 0, recoveredAmount: 0 }; mem.set(no, m); }
        const k = Number(x.KUBUN), amt = Number(x.AMT) || 0;
        if (k === 4 || k === 0) m.unpaidAmount += amt;       // 未納 / 未処理は未納側
        else if (k === 3) m.recoveredAmount += amt;          // 後日回収
      }
      const all = [...mem.values()];
      return resp(200, {
        ym: ymP,
        unpaid: all.filter((m) => m.unpaidAmount > 1).sort((a, b) => b.unpaidAmount - a.unpaidAmount),
        recovered: all.filter((m) => m.recoveredAmount > 1 && m.unpaidAmount <= 1).sort((a, b) => b.recoveredAmount - a.recoveredAmount),
      });
    } catch (err) {
      return resp(500, { error: "internal_error", message: err.message });
    } finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // 経理連携: 振替契約別の月次集計 (クラブ×振替結果×税率×委託先×企業)。月次処理CSV用。
  if (type === "furikae_summary") {
    const ym = Number(params.ym || 0);
    if (!ym || String(params.ym).length !== 6) return resp(400, { error: "missing_params", required: ["ym(YYYYMM)"] });
    // クラブ略称は「クラブ」テーブルから取得(2026-07 変更)。「クラブ」には業態/企業名が無いため、
    // 業態・企業名は「クラブ情報」からクラブコードで LEFT JOIN して補填する。
    const sql = `
      SELECT
        a.クラブコード AS クラブコード,
        i.クラブ略称 AS クラブ略称,
        ci.業態 AS 業態,
        ci.企業名 AS 企業名,
        a.振替年月 AS 振替年月,
        h.委託先名 AS 委託先名,
        CASE WHEN a.振替結果コード = '0' THEN '入金済み' ELSE '未回収' END AS 振替結果,
        e.税率 AS 税率,
        SUM(a.振替金額) AS 振替合計,
        SUM(a.年管理費金額) AS 年管理費合計,
        SUM(a.会費金額) AS 会費合計,
        SUM(a.割引金額) AS 割引合計
      FROM FIT_ADMIN."振替契約別" a
      LEFT JOIN FIT_ADMIN."振替結果" b ON a.振替結果コード = b.振替結果コード
      INNER JOIN FIT_ADMIN."契約形態" c ON a.契約形態コード = c.契約形態コード
      INNER JOIN FIT_ADMIN."商品" d ON c.会費商品コード = d.商品コード
      INNER JOIN FIT_ADMIN."税" e ON d.税コード = e.税コード
      INNER JOIN FIT_ADMIN."クラブ" g ON a.クラブコード = g.クラブコード
      INNER JOIN FIT_ADMIN."委託先" h ON a.委託先コード = h.委託先コード
      LEFT JOIN FIT_ADMIN."クラブ" i ON a.クラブコード = i.クラブコード
      LEFT JOIN FIT_ADMIN."クラブ情報" ci ON a.クラブコード = ci.クラブコード
      WHERE a.振替年月 = :ym
        AND e.適用終了月 = 999999
        AND a.振替結果コード IS NOT NULL
      GROUP BY a.クラブコード, a.振替結果コード, a.振替年月, e.税率, h.委託先名, i.クラブ略称, ci.業態, ci.企業名
      ORDER BY a.クラブコード, a.振替結果コード, e.税率`;
    let conn;
    try {
      const pool = await getPool(); conn = await pool.getConnection();
      const r = await conn.execute(sql, { ym }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return resp(200, { ym, rows: r.rows || [] });
    } catch (err) {
      return resp(500, { error: "internal_error", message: err.message });
    } finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // 貸倒処理(経理連携): 対応年月ごとに 会員別の 入金済み(区分3)/未納(区分4) 請求額を集計。
  // 未納(区分4)が貸倒処理の対象。委託先/クラブ/カンパニー単位で会員別に一覧化する。
  // 会員単位のため行数が多く Lambda 応答上限(6MB)を超えるので offset/limit でページングする。
  // 呼び出し側(API)が hasMore を見て全ページを取得し CSV に結合する。
  if (type === "writeoff_summary") {
    const ym = Number(params.ym || 0);
    if (!ym || String(params.ym).length !== 6) return resp(400, { error: "missing_params", required: ["ym(YYYYMM)"] });
    const limit = Math.min(Math.max(Number(params.limit) || 10000, 1), 20000);
    const offset = Math.max(Number(params.offset) || 0, 0);
    // 既定は貸倒対象=未納(入金区分4)のみ。includePaid=1 で入金済み(区分3)も含む(件数が桁違いに増える)。
    const kubunIn = params.includePaid === "1" ? "3, 4" : "4";
    // グループ化結果を ROWNUM ウィンドウでページング (Oracle)。
    const sql = `
      SELECT 対応年月, 委託先コード, クラブコード, クラブ略称, カンパニー名, 会員番号, 集計種別, 件数, 請求額合計
      FROM (
        SELECT g.*, ROWNUM rn FROM (
          SELECT
            a.対応年月 AS 対応年月,
            a.委託先コード AS 委託先コード,
            cl.クラブコード AS クラブコード,
            cl.クラブ略称 AS クラブ略称,
            c.カンパニー名 AS カンパニー名,
            b.会員番号 AS 会員番号,
            CASE a.入金区分コード WHEN 3 THEN '入金済み' WHEN 4 THEN '未納' END AS 集計種別,
            COUNT(*) AS 件数,
            SUM(a.請求額) AS 請求額合計
          FROM FIT_ADMIN."会員入金歴" a
          INNER JOIN FIT_ADMIN."会員番号" b ON a.契約者SEQ = b.契約者SEQ
          INNER JOIN FIT_ADMIN."会員契約" d ON a.契約者SEQ = d.契約者SEQ AND a.契約SEQ = d.契約SEQ
          INNER JOIN FIT_ADMIN."クラブ" cl ON d.クラブコード = cl.クラブコード
          LEFT  JOIN FIT_ADMIN."クラブ情報" c ON d.クラブコード = c.クラブコード
          WHERE a.対応年月 = :ym
            AND a.入金区分コード IN (${kubunIn})
          GROUP BY a.対応年月, a.委託先コード, cl.クラブコード, cl.クラブ略称, c.カンパニー名, b.会員番号, a.入金区分コード
          HAVING SUM(a.請求額) > 0
          ORDER BY cl.クラブコード, b.会員番号, a.入金区分コード
        ) g WHERE ROWNUM <= :maxRow
      ) WHERE rn > :off`;
    let conn;
    try {
      const pool = await getPool(); conn = await pool.getConnection();
      // 全件CSVエクスポート: クエリを1回だけ実行し resultSet でストリーム構築 → gzip して base64 で返す。
      // 会員単位31万行でも gzip 後は数MBに収まり Lambda応答6MB制限を回避できる(呼び出し側で解凍)。
      if (params.gzip === "1") {
        const zlib = await import("node:zlib");
        const exSql = `
          SELECT
            a.対応年月 AS Y, a.委託先コード AS I, cl.クラブコード AS CC, cl.クラブ略称 AS CN,
            c.カンパニー名 AS CO, b.会員番号 AS MN,
            CASE a.入金区分コード WHEN 3 THEN '入金済み' WHEN 4 THEN '未納' END AS K,
            COUNT(*) AS CNT, SUM(a.請求額) AS AMT
          FROM FIT_ADMIN."会員入金歴" a
          INNER JOIN FIT_ADMIN."会員番号" b ON a.契約者SEQ = b.契約者SEQ
          INNER JOIN FIT_ADMIN."会員契約" d ON a.契約者SEQ = d.契約者SEQ AND a.契約SEQ = d.契約SEQ
          INNER JOIN FIT_ADMIN."クラブ" cl ON d.クラブコード = cl.クラブコード
          LEFT  JOIN FIT_ADMIN."クラブ情報" c ON d.クラブコード = c.クラブコード
          WHERE a.対応年月 = :ym AND a.入金区分コード IN (${kubunIn})
          GROUP BY a.対応年月, a.委託先コード, cl.クラブコード, cl.クラブ略称, c.カンパニー名, b.会員番号, a.入金区分コード
          HAVING SUM(a.請求額) > 0
          ORDER BY cl.クラブコード, b.会員番号, a.入金区分コード`;
        const t0 = Date.now();
        const rs = (await conn.execute(exSql, { ym }, { outFormat: oracledb.OUT_FORMAT_OBJECT, resultSet: true })).resultSet;
        const cell = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const parts = ["対応年月,委託先コード,クラブコード,クラブ略称,カンパニー名,会員番号,集計種別,件数,請求額合計\r\n"];
        let count = 0;
        for (;;) {
          const batch = await rs.getRows(2000);
          if (batch.length === 0) break;
          let chunk = "";
          for (const x of batch) {
            chunk += [x.Y, x.I, x.CC, cell(x.CN), cell(x.CO), x.MN, x.K, x.CNT, x.AMT].join(",") + "\r\n";
          }
          parts.push(chunk);
          count += batch.length;
        }
        await rs.close();
        const gz = zlib.gzipSync(Buffer.from(parts.join(""), "utf-8"));
        return resp(200, { ym, count, queryMs: Date.now() - t0, gzB64: gz.toString("base64") });
      }
      if (params.countOnly === "1") {
        const t0 = Date.now();
        // 種別(入金済み/未納)ごとの 件数・金額の内訳を返す (会員×区分の集計行を種別で再集計)。
        const cq = await conn.execute(
          `SELECT 集計種別 AS K, COUNT(*) AS 件数, SUM(請求額合計) AS 金額 FROM (
             SELECT CASE a.入金区分コード WHEN 3 THEN '入金済み' WHEN 4 THEN '未納' END AS 集計種別,
                    SUM(a.請求額) AS 請求額合計
             FROM FIT_ADMIN."会員入金歴" a
             INNER JOIN FIT_ADMIN."会員番号" b ON a.契約者SEQ = b.契約者SEQ
             INNER JOIN FIT_ADMIN."会員契約" d ON a.契約者SEQ = d.契約者SEQ AND a.契約SEQ = d.契約SEQ
             INNER JOIN FIT_ADMIN."クラブ" cl ON d.クラブコード = cl.クラブコード
             LEFT  JOIN FIT_ADMIN."クラブ情報" c ON d.クラブコード = c.クラブコード
             WHERE a.対応年月 = :ym AND a.入金区分コード IN (${kubunIn})
             GROUP BY a.対応年月, a.委託先コード, cl.クラブコード, cl.クラブ略称, c.カンパニー名, b.会員番号, a.入金区分コード
             HAVING SUM(a.請求額) > 0
           ) GROUP BY 集計種別`,
          { ym }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const breakdown = (cq.rows || []).map((x) => ({ 集計種別: x.K, 件数: Number(x.件数) || 0, 金額: Number(x.金額) || 0 }));
        const total = breakdown.reduce((s, x) => s + x.件数, 0);
        return resp(200, { ym, total, breakdown, queryMs: Date.now() - t0 });
      }
      const r = await conn.execute(sql, { ym, maxRow: offset + limit, off: offset }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const rows = r.rows || [];
      return resp(200, { ym, offset, limit, rows, hasMore: rows.length === limit });
    } catch (err) {
      return resp(500, { error: "internal_error", message: err.message });
    } finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // 未納管理 ダッシュボード全体数値 (クラブ複数可・エリア合算用)
  if (type === "unpaid_summary") {
    const clubs = (params.clubCodes || params.clubCode || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    if (clubs.length === 0) {
      return resp(400, { error: "missing_params", required: ["clubCode or clubCodes"] });
    }
    const ym = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const now = new Date();
    const from = new Date(now); from.setMonth(from.getMonth() - 11); // 既定: 直近12ヶ月
    const clubBindNames = clubs.map((_, i) => `:club${i}`);
    const binds = {
      fromYm: Number(params.fromYm || ym(from)),
      toYm: Number(params.toYm || ym(now)),
    };
    clubs.forEach((c, i) => { binds[`club${i}`] = c; });
    // summarySql は :forcedReason を使う(強制退会除きの集計)。followupSql は使わないため別 binds。
    const summaryBinds = { ...binds, forcedReason: (params.forcedReason || "42").trim() };
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(unpaidSummarySql(clubBindNames), summaryBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const fu = await conn.execute(unpaidFollowupSql(clubBindNames), binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const out = buildUnpaidSummary(r.rows || []);
      const followup = buildUnpaidFollowup(fu.rows || []); // ②未納その後(会員入金歴 入金区分)
      // 月次内訳に「後日回収/現未納」をマージ (未納に対しどれだけ回収できたか)
      const fuByMonth = followup.byMonth; delete followup.byMonth;
      for (const mrow of out.byMonth) {
        const fm = fuByMonth.get(mrow.month);
        mrow.recoveredAmount = fm ? fm.recoveredAmount : 0;     // 後日回収(支払済)
        mrow.stillUnpaidAmount = fm ? fm.stillUnpaidAmount : 0; // 現未納
      }
      out.followup = followup;
      return resp(200, out);
    } catch (err) {
      console.error("unpaid_summary error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // 未納管理: 現在の未納 / いつ入金されたか / 貸し倒れ候補 (振替結果コード基準)
  if (type === "unpaid_current" || type === "unpaid_paid" || type === "unpaid_writeoff") {
    // クラブは単一(clubCode)または複数(clubCodes・エリアCSV用)
    const clubsArr = (params.clubCodes || params.clubCode || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    if (clubsArr.length === 0) {
      return resp(400, { error: "missing_params", required: ["clubCode or clubCodes"] });
    }
    const ym = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const now = new Date();
    const clubBindNames = clubsArr.map((_, i) => `:club${i}`);
    const clubClause = `f.クラブコード IN (${clubBindNames.join(",")})`;
    const binds = {};
    clubsArr.forEach((c, i) => { binds[`club${i}`] = c; });
    const forcedReason = (params.forcedReason || "42").trim();
    // 未納一覧の対象範囲: 既定 2025年度(202504)以降。古い年度の未納(年管理費の複数年計上等)を除外。
    const fromYm = Number(params.fromYm || 202504);
    let sql;
    if (type === "unpaid_current") {
      binds.forcedReason = forcedReason; // 貸倒予定(強制退会)を除外
      binds.fromYm = fromYm;
      // ③ cohort=1 → 全体(確定時点): 入金区分4フィルタ無し。既にアプリ入金済も残す(消えない)。
      sql = params.cohort === "1" ? unpaidCohortSql(clubClause) : unpaidCurrentSql(clubClause);
    } else if (type === "unpaid_paid") {
      const from = new Date(now); from.setMonth(from.getMonth() - 12);
      binds.fromYmd = Number(params.fromYmd || `${ym(from)}01`); // 既定: 直近12ヶ月の入金分
      // unpaid_paid は単一クラブのみ対応 (CSVは current/writeoff)
      binds.clubCode = clubsArr[0];
      sql = UNPAID_PAID_SQL;
    } else {
      binds.forcedReason = forcedReason; // 貸倒予定(強制退会)のみ
      binds.fromYm = fromYm;
      sql = unpaidWriteoffSql(clubClause);
    }
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return resp(200, buildUnpaidFurikae(type, r.rows || []));
    } catch (err) {
      console.error(`${type} error`, err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // ターゲット抽出用: その店舗に属する契約種別(会員区分)を全て返す。
  // 会員契約(クラブコード=:clubCode) を 会員区分 と JOIN し、種別ごとに
  // 総契約数 / 在籍中契約数 を集計。在籍中(退会日 IS NULL or 99999999 sentinel)が
  // 多い順に並べる。フロントの契約種別サジェスト/フィルタの母集合になる。
  if (type === "contract_types") {
    const clubCode = (params.clubCode || "").trim();
    if (!clubCode) {
      return resp(400, { error: "missing_params", required: ["clubCode"] });
    }
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(
        CONTRACT_TYPES_SQL,
        { clubCode: Number(clubCode) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const results = (r.rows || []).map((row) => ({
        code: row.CODE != null ? String(row.CODE) : "",
        name: row.NAME != null ? String(row.NAME).trim() : "",
        totalCount: Number(row.TOTAL_CNT || 0),
        activeCount: Number(row.ACTIVE_CNT || 0),
      })).filter((x) => x.name);
      return resp(200, { ok: true, clubCode, results, totalTypes: results.length });
    } catch (err) {
      console.error("contract_types error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // ターゲット抽出用: 会員区分に紐づく契約形態名を返す。
  if (type === "contract_forms") {
    const clubCode = (params.clubCode || "").trim();
    if (!clubCode) {
      return resp(400, { error: "missing_params", required: ["clubCode"] });
    }
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(
        CONTRACT_FORMS_SQL,
        { clubCode: Number(clubCode) },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const results = (r.rows || []).map((row) => ({
        planCode: row.PLAN_CODE != null ? String(row.PLAN_CODE) : "",
        planName: row.PLAN_NAME != null ? String(row.PLAN_NAME).trim() : "",
        code: row.FORM_CODE != null ? String(row.FORM_CODE) : "",
        name: row.FORM_NAME != null ? String(row.FORM_NAME).trim() : "",
        totalCount: Number(row.TOTAL_CNT || 0),
        activeCount: Number(row.ACTIVE_CNT || 0),
      })).filter((x) => x.name);
      return resp(200, { ok: true, clubCode, results, totalForms: results.length });
    } catch (err) {
      console.error("contract_forms error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally {
      if (conn) { try { await conn.close(); } catch (_) {} }
    }
  }

  // 会員抽出 (DM/Push ターゲティング)。条件グループ(グループ内AND/グループ間groupOp)で
  // 会員区分名(contractTypes)・契約形態名(contractForms)・性別・在籍状況で絞り込む。
  if (type === "member_extract") {
    let body = {};
    try {
      if (params.payload) body = JSON.parse(Buffer.from(params.payload, "base64").toString("utf-8"));
      else if (event.body) body = JSON.parse(event.body);
    } catch (_) { body = {}; }
    // クラブは複数(clubCodes)または単一(clubCode)。
    const clubCodesArr = (Array.isArray(body.clubCodes) ? body.clubCodes : String(body.clubCode || params.clubCode || "").split(","))
      .map((s) => String(s).trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
    if (clubCodesArr.length === 0) return resp(400, { error: "missing_params", required: ["clubCode(s)"] });
    const groups = Array.isArray(body.groups) && body.groups.length > 0 ? body.groups : [{}];
    const groupOp = body.groupOp === "AND" ? "AND" : "OR";
    const limit = Math.min(Math.max(Number(body.limit) || 1000, 1), 5000);

    const binds = {};
    let bi = 0;
    const inList = (vals, cast) => vals.map((v) => { const k = `b${bi++}`; binds[k] = cast ? cast(v) : v; return `:${k}`; }).join(",");
    const clubIn = clubCodesArr.map((c) => { const k = `cl${bi++}`; binds[k] = c; return `:${k}`; }).join(",");
    // 来館回数(入館トラン)テーブル。KNOWBIE_RO に未付与のため既定は無効。
    // DBAが会員別入館ログ表への SELECT を付与したら VISIT_TABLE='FIT_ADMIN."入館トラン"' 等を設定して有効化する。
    const VISIT_TABLE = process.env.VISIT_TABLE || "";
    let visitCountIgnored = false; // 来館回数指定があったが表未設定で適用できなかった場合 true
    // 各条件は会員(b.契約者SEQ)単位の EXISTS。契約(会員区分)と契約形態が別契約でも会員で結合。
    const groupSql = groups.map((g) => {
      const conds = [];
      const genders = Array.isArray(g.genderCodes) ? g.genderCodes.filter((x) => x === 1 || x === 2) : [];
      if (genders.length > 0 && genders.length < 2) conds.push(`a.性別コード IN (${inList(genders)})`);
      const ms = Array.isArray(g.membershipStatus) ? g.membershipStatus : [];
      const stable = ms.includes("stable"), leaver = ms.includes("leaver");
      let msCond = "";
      if (stable && !leaver) msCond = ` AND (cc.退会日 IS NULL OR TO_CHAR(cc.退会日) = '99999999')`;
      else if (leaver && !stable) msCond = ` AND (cc.退会日 IS NOT NULL AND TO_CHAR(cc.退会日) <> '99999999')`;
      if (msCond) conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" cc WHERE cc.契約者SEQ = b.契約者SEQ AND cc.クラブコード IN (${clubIn})${msCond})`);
      const cts = Array.isArray(g.contractTypes) ? g.contractTypes.filter(Boolean) : [];
      if (cts.length > 0) {
        conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" c1 JOIN FIT_ADMIN."会員区分" k1 ON k1.会員区分コード = c1.会員区分コード
                    WHERE c1.契約者SEQ = b.契約者SEQ AND c1.クラブコード IN (${clubIn}) AND k1.会員区分名 IN (${inList(cts)}))`);
      }
      const cfs = Array.isArray(g.contractForms) ? g.contractForms.filter(Boolean) : [];
      if (cfs.length > 0) {
        conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" c2
                      JOIN FIT_ADMIN."会員契約明細" d ON d.契約SEQ = c2.契約SEQ
                      JOIN FIT_ADMIN."契約形態" e ON d.契約形態コード = e.契約形態コード
                    WHERE c2.契約者SEQ = b.契約者SEQ AND c2.クラブコード IN (${clubIn}) AND e.契約形態名 IN (${inList(cfs)}))`);
      }
      // 来館回数(visitCountFrom/To): 対象期間(visitFrom/To, YYYYMMDD)内の入館ログ件数で絞る。
      // COUNT(*) を使うため「契約はあるが入館ログが無い人 = 0回」も自然に評価できる(0回抽出対応)。
      // 入館ログ表は KNOWBIE_RO 未付与のため、VISIT_TABLE が設定されている時のみ適用する。
      const vMin = Number.isFinite(Number(g.visitCountFrom)) ? Number(g.visitCountFrom) : null;
      const vMax = Number.isFinite(Number(g.visitCountTo)) ? Number(g.visitCountTo) : null;
      if (vMin !== null || vMax !== null) {
        if (!VISIT_TABLE) {
          visitCountIgnored = true; // 表未設定: この条件は無視(件数に反映されない)
        } else {
          const dateConds = [];
          if (g.visitFrom) { const k = `vf${bi++}`; binds[k] = Number(g.visitFrom); dateConds.push(`gv.営業年月日 >= :${k}`); }
          if (g.visitTo) { const k = `vt${bi++}`; binds[k] = Number(g.visitTo); dateConds.push(`gv.営業年月日 <= :${k}`); }
          const dateWhere = dateConds.length ? ` AND ${dateConds.join(" AND ")}` : "";
          const cntExpr = `(SELECT COUNT(*) FROM ${VISIT_TABLE} gv WHERE gv.会員番号 = b.会員番号 AND gv.クラブコード IN (${clubIn})${dateWhere})`;
          const range = [];
          if (vMin !== null) { const k = `vn${bi++}`; binds[k] = vMin; range.push(`${cntExpr} >= :${k}`); }
          if (vMax !== null) { const k = `vx${bi++}`; binds[k] = vMax; range.push(`${cntExpr} <= :${k}`); }
          conds.push(`(${range.join(" AND ")})`);
        }
      }
      // 入会日範囲(joinDateFrom/To, YYYYMMDD): 会員クラブ契約."Tクラブ入会年月日"(NUMBER)で絞る。
      if (g.joinDateFrom || g.joinDateTo) {
        const jc = [];
        if (g.joinDateFrom) { const k = `jf${bi++}`; binds[k] = Number(g.joinDateFrom); jc.push(`jc."Tクラブ入会年月日" >= :${k}`); }
        if (g.joinDateTo) { const k = `jt${bi++}`; binds[k] = Number(g.joinDateTo); jc.push(`jc."Tクラブ入会年月日" <= :${k}`); }
        conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."会員クラブ契約" jc WHERE jc.契約者SEQ = b.契約者SEQ AND jc.クラブコード IN (${clubIn}) AND ${jc.join(" AND ")})`);
      }
      // 退会日範囲(leaveDateFrom/To, YYYYMMDD): 会員契約.退会日(NUMBER, 99999999=在籍sentinel)で絞る。
      if (g.leaveDateFrom || g.leaveDateTo) {
        const lc = [`lc.退会日 IS NOT NULL`, `lc.退会日 <> 99999999`];
        if (g.leaveDateFrom) { const k = `lf${bi++}`; binds[k] = Number(g.leaveDateFrom); lc.push(`lc.退会日 >= :${k}`); }
        if (g.leaveDateTo) { const k = `lt${bi++}`; binds[k] = Number(g.leaveDateTo); lc.push(`lc.退会日 <= :${k}`); }
        conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" lc WHERE lc.契約者SEQ = b.契約者SEQ AND lc.クラブコード IN (${clubIn}) AND ${lc.join(" AND ")})`);
      }
      // 未納のみ(hasUnpaidOnly): 振替失敗(振替結果コード≠0)かつ会員入金歴で未納(入金区分コード=4)がある会員。
      // (未納画面の「現行未納」判定と同一ロジック)
      if (g.hasUnpaidOnly) {
        conds.push(`EXISTS (SELECT 1 FROM FIT_ADMIN."振替契約別" fu
                      WHERE fu.契約者SEQ = b.契約者SEQ AND fu.クラブコード IN (${clubIn})
                        AND TRIM(fu.振替結果コード) <> '0'
                        AND EXISTS (SELECT 1 FROM FIT_ADMIN."会員入金歴" au
                                     WHERE au.契約SEQ = fu.契約SEQ AND au.対応年月 = fu.振替年月 AND au.入金区分コード = 4))`);
      }
      return conds.length > 0 ? `(${conds.join(" AND ")})` : "(1=1)";
    });
    const groupWhere = groups.length > 1 ? `(${groupSql.join(` ${groupOp} `)})` : groupSql[0];

    // 契約形態名による除外 (家族会員/1DayPass 等を LIKE で除外)。在籍中の契約が対象。
    const exFormsLike = Array.isArray(body.excludeContractFormsLike)
      ? body.excludeContractFormsLike.map((s) => String(s).trim()).filter(Boolean) : [];
    let excludeSql = "";
    for (const pat of exFormsLike) {
      const k = `ex${bi++}`; binds[k] = `%${pat}%`;
      excludeSql += `
          AND NOT EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" ce
                            JOIN FIT_ADMIN."会員契約明細" de ON de.契約SEQ = ce.契約SEQ
                            JOIN FIT_ADMIN."契約形態" ee ON ee.契約形態コード = de.契約形態コード
                          WHERE ce.契約者SEQ = b.契約者SEQ AND ce.クラブコード IN (${clubIn})
                            AND ee.契約形態名 LIKE :${k}
                            AND (ce.退会日 IS NULL OR TO_CHAR(ce.退会日) >= TO_CHAR(SYSDATE, 'YYYYMMDD')))`;
    }

    const sql = `
      SELECT * FROM (
        SELECT DISTINCT
          b.会員番号 AS MEMBER_NO,
          a.漢字姓名 AS NAME,
          a.カナ姓 || a.カナ名 AS KANA,
          CASE WHEN a.生年月日 BETWEEN 18000101 AND 30000101
               THEN SUBSTR(TO_CHAR(a.生年月日),1,4)||'-'||SUBSTR(TO_CHAR(a.生年月日),5,2)||'-'||SUBSTR(TO_CHAR(a.生年月日),7,2) END AS BIRTHDAY,
          a.性別コード AS GENDER_CODE,
          (SELECT MIN(c0b.クラブコード) FROM FIT_ADMIN."会員契約" c0b WHERE c0b.契約者SEQ = b.契約者SEQ AND c0b.クラブコード IN (${clubIn})) AS CLUB_CODE,
          (SELECT MIN(k9.会員区分名) FROM FIT_ADMIN."会員契約" c9 JOIN FIT_ADMIN."会員区分" k9 ON k9.会員区分コード = c9.会員区分コード
             WHERE c9.契約者SEQ = b.契約者SEQ AND c9.クラブコード IN (${clubIn})
               AND c9.会員区分コード IN (1, 60, 70)
               AND (c9.退会日 IS NULL OR TO_CHAR(c9.退会日) >= TO_CHAR(SYSDATE, 'YYYYMMDD'))) AS CONTRACT_NAME,
          a.EMAIL AS EMAIL
        FROM FIT_ADMIN."会員番号" b
        JOIN FIT_ADMIN."個人" a ON a.個人SEQ = b.個人SEQ
        WHERE EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" c0 WHERE c0.契約者SEQ = b.契約者SEQ AND c0.クラブコード IN (${clubIn}))
          -- 【絶対条件】DM/Push の会員参照は「在籍中の会員区分コード 1/60/70」のみ。
          -- 在籍=退会日が未設定 or 今日以降 (99999999 も TO_CHAR比較で today 以上=在籍)。タイム会員=8 等は除外。
          AND EXISTS (SELECT 1 FROM FIT_ADMIN."会員契約" ck
                       WHERE ck.契約者SEQ = b.契約者SEQ AND ck.クラブコード IN (${clubIn})
                         AND ck.会員区分コード IN (1, 60, 70)
                         AND (ck.退会日 IS NULL OR TO_CHAR(ck.退会日) >= TO_CHAR(SYSDATE, 'YYYYMMDD')))${excludeSql}
          AND ${groupWhere}
      ) WHERE ROWNUM <= ${limit}`;

    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const results = (r.rows || []).map((x) => ({
        memberNo: String(x.MEMBER_NO),
        name: x.NAME || "",
        kana: x.KANA || "",
        birthday: x.BIRTHDAY || null,
        genderCode: x.GENDER_CODE != null ? Number(x.GENDER_CODE) : null,
        clubCode: x.CLUB_CODE != null ? String(x.CLUB_CODE) : String(clubCodesArr[0]),
        contractName: x.CONTRACT_NAME || null,
        withdrawnAt: (x.WITHDRAWN != null && String(x.WITHDRAWN).trim() !== "" && String(x.WITHDRAWN).trim() !== "99999999") ? String(x.WITHDRAWN).trim() : null,
        email: x.EMAIL || null,
      }));
      return resp(200, { results, totalCount: results.length, visitCountIgnored });
    } catch (err) {
      console.error("member_extract error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally { if (conn) { try { await conn.close(); } catch (_) {} } }
  }

  // ポイント集計用: 会員番号リスト → 性別/生年月日/入会日 を一括取得
  //   POST body(base64 payload) { memberNos: ["5110001234", ...] }  (最大1000件)
  if (type === "demographics") {
    let body = {};
    try {
      if (params.payload) body = JSON.parse(Buffer.from(params.payload, "base64").toString("utf-8"));
      else if (event.body) body = JSON.parse(event.body);
    } catch (_) { body = {}; }
    const nos = (Array.isArray(body.memberNos) ? body.memberNos : [])
      .map((s) => String(s).trim()).filter((s) => /^\d+$/.test(s)).slice(0, 1000);
    if (nos.length === 0) return resp(400, { error: "missing_params", required: ["memberNos"] });
    const binds = {};
    const inList = nos.map((v, i) => { binds[`m${i}`] = v; return `:m${i}`; }).join(",");
    const sql = `
      SELECT
        b.会員番号 AS MEMBER_NO,
        a.性別コード AS GENDER_CODE,
        CASE WHEN a.生年月日 BETWEEN 18000101 AND 30000101
             THEN SUBSTR(TO_CHAR(a.生年月日),1,4)||'-'||SUBSTR(TO_CHAR(a.生年月日),5,2)||'-'||SUBSTR(TO_CHAR(a.生年月日),7,2) END AS BIRTHDAY,
        (SELECT TO_CHAR(MIN(c.入会届出日)) FROM FIT_ADMIN."会員契約" c WHERE c.契約者SEQ = b.契約者SEQ) AS JOIN_DATE
      FROM FIT_ADMIN."会員番号" b
      JOIN FIT_ADMIN."個人" a ON a.個人SEQ = b.個人SEQ
      WHERE b.会員番号 IN (${inList})`;
    let conn;
    try {
      const pool = await getPool();
      conn = await pool.getConnection();
      const r = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const results = (r.rows || []).map((x) => {
        const jr = x.JOIN_DATE != null ? String(x.JOIN_DATE) : null;
        const joinDate = jr && jr.length === 8 ? `${jr.slice(0,4)}-${jr.slice(4,6)}-${jr.slice(6,8)}` : null;
        return {
          memberNo: String(x.MEMBER_NO),
          genderCode: x.GENDER_CODE != null ? Number(x.GENDER_CODE) : null, // 1=男 2=女
          birthday: x.BIRTHDAY || null,
          joinDate,
        };
      });
      return resp(200, { results, totalCount: results.length });
    } catch (err) {
      console.error("demographics error", err);
      return resp(500, { error: "internal_error", message: err.message });
    } finally { if (conn) { try { await conn.close(); } catch (_) {} } }
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
  // 退会日 '99999999'/NULL は在籍中(現行会員)とみなす
  const memberStatus = (withdrawnAt && withdrawnRaw !== "99999999") ? "withdrawn" : "active";
  const joinRaw = first.JOIN_DATE != null ? String(first.JOIN_DATE) : null;
  const joinDate = joinRaw && joinRaw.length === 8
    ? `${joinRaw.slice(0, 4)}-${joinRaw.slice(4, 6)}-${joinRaw.slice(6, 8)}`
    : null;

  const member = {
    memberNo: first.MEMBER_NO != null ? String(first.MEMBER_NO) : null,
    kojinSeq: first.KOJIN_SEQ != null ? String(first.KOJIN_SEQ) : null,
    name: first.NAME_KANJI != null ? String(first.NAME_KANJI) : null, // 個人.漢字姓名
    kana: first.HOLDER_NAME != null ? String(first.HOLDER_NAME) : null,
    phone: first.PHONE != null ? String(first.PHONE) : null,
    plan: first.PLAN_NAME ?? null,
    planCode: first.PLAN_CODE ?? null,
    isCorporate: first.IS_CORPORATE === 1 || first.IS_CORPORATE === "1",
    joinClubCode: first.CLUB_CODE != null ? String(first.CLUB_CODE) : null,
    joinClubName: null,
    joinDate,          // 入会届出日 (継続期間の起点)
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
    name: first.NAME_KANJI != null ? String(first.NAME_KANJI) : null,
    kana: first.HOLDER_NAME != null ? String(first.HOLDER_NAME) : null,
    phone: first.PHONE != null ? String(first.PHONE) : null,
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
