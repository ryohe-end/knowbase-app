// lambdas/post-restore-setup/index.mjs
// RDSスナップショット復元完了をトリガに、knowbie 用の readonly ユーザー作成・
// 必要なインデックス追加・統計情報更新を行う。
//
// 想定トリガ: EventBridge ルール
//   source: ["aws.rds"]
//   detail-type: ["RDS DB Instance Event"]
//   detail.SourceIdentifier: ["adb01"]
//   detail.EventCategories: ["restoration"]   (RDS-EVENT-0088)
//
// 環境変数:
//   ORACLE_ADMIN_SECRET_ARN  管理者(adbuser等) の認証情報 Secret ARN
//   ORACLE_RO_SECRET_ARN     作成する knowbie_ro の認証情報 Secret ARN
//
// 注意: 復元直後の DBが open するまでに数分の余裕が必要なので、EventBridge 側で
// 30〜60秒の遅延 (Step Functions Wait) を挟むのが推奨。

import oracledb from "oracledb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const sm = new SecretsManagerClient({ region: REGION });

async function getSecret(arn) {
  const r = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  return JSON.parse(r.SecretString);
}

// 既存判定用ヘルパ (OUT_FORMAT_OBJECT 下では rows[0] が { COL: value } なので
// Object.values で1列目を取得する。array index アクセスだと undefined になる)
async function exists(conn, sql, binds) {
  const r = await conn.execute(sql, binds);
  const row = r.rows?.[0];
  if (!row) return false;
  const count = Object.values(row)[0] ?? 0;
  return Number(count) > 0;
}

// --- セットアップ手順 --------------------------------------------------------
async function setup(adminCfg, roCfg) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });

  const log = [];
  try {
    // ① knowbie_ro ユーザー作成 (既存ならパスワード更新)
    const userExists = await exists(
      conn,
      `SELECT COUNT(*) FROM all_users WHERE username = :u`,
      { u: roCfg.user.toUpperCase() }
    );

    if (userExists) {
      await conn.execute(`ALTER USER ${roCfg.user} IDENTIFIED BY "${roCfg.password}"`);
      log.push("user altered");
    } else {
      await conn.execute(`CREATE USER ${roCfg.user} IDENTIFIED BY "${roCfg.password}"`);
      log.push("user created");
    }

    // ② 権限付与
    await conn.execute(`GRANT CREATE SESSION TO ${roCfg.user}`);
    // 検索系 + 未納管理(振替/入金)系。未納は 振替契約別(振替結果コード≠0=未納) を権威とし
    // 会員入金歴/会員契約/会員区分/会費分類 と結合して集計する。
    const roTables = [
      "個人", "会員番号", "会員番号_外部ID", "会員番号_外部ID_削除", "個人電話番号", "会員クラブ契約", "CSクラブ",
      "振替契約別", "会員入金歴", "会員契約", "会員区分", "会費分類",
      // ターゲット抽出: 会員区分に紐づく契約形態(会員契約明細→契約形態)
      "会員契約明細", "契約形態",
      // 返金・入金(返金画面): 口座情報
      "会員契約者口座",
      // ビーコン日次同期用 (ゲート/ビーコン系)
      "ゲートコントロールマスタ", "BEACONQRマスタ", "PDAゲートNO変換", "クラブWS", "エリア入室設定",
      // 月次処理(経理連携CSV: furikae_summary)の JOIN 先。振替契約別 と結合して税率/委託先/クラブ情報を出す。
      "商品", "税", "委託先", "クラブ情報", "振替結果",
      // DM/Push ターゲティングの来館回数(visitCount)フィルタ用: 会員別入館ログ。
      // member-search の env VISIT_TABLE='FIT_ADMIN."入館トラン"' で有効化している。
      "入館トラン",
    ];
    for (const tbl of roTables) {
      await conn.execute(`GRANT SELECT ON FIT_ADMIN."${tbl}" TO ${roCfg.user}`);
    }
    log.push("grants applied");

    // ③ EMAIL カラムのインデックス追加 (存在チェック付き)
    const emailIdxExists = await exists(
      conn,
      `SELECT COUNT(*) FROM all_indexes
        WHERE table_owner = 'FIT_ADMIN'
          AND table_name  = '個人'
          AND index_name  = 'IDX_KOJIN_EMAIL'`,
      {}
    );
    if (!emailIdxExists) {
      await conn.execute(`CREATE INDEX FIT_ADMIN.IDX_KOJIN_EMAIL ON FIT_ADMIN."個人"(EMAIL)`);
      log.push("idx_kojin_email created");
    } else {
      log.push("idx_kojin_email already exists");
    }

    // ③-2 貸倒処理(会員入金歴の月×入金区分 集計)の高速化インデックス。
    // 会員入金歴 は 対応年月 単独で使える索引が無くフルスキャン(≈38s)になるため、
    // (対応年月, 入金区分コード) を作成すると ≈1s に短縮できる(API Gateway 29s 制限内に収まる)。
    // 注: 大テーブルのため作成に ~140秒かかる。Lambda timeout は 300s に設定済み。
    const nyukinIdxExists = await exists(
      conn,
      `SELECT COUNT(*) FROM all_indexes
        WHERE table_owner = 'FIT_ADMIN' AND table_name = '会員入金歴' AND index_name = 'IDX_NYUKIN_YM_KUBUN'`,
      {}
    );
    if (!nyukinIdxExists) {
      await conn.execute(`CREATE INDEX FIT_ADMIN.IDX_NYUKIN_YM_KUBUN ON FIT_ADMIN."会員入金歴"("対応年月", "入金区分コード")`);
      log.push("idx_nyukin_ym_kubun created");
    } else {
      log.push("idx_nyukin_ym_kubun already exists");
    }

    // ④ 統計情報更新 (オプティマイザのため)
    await conn.execute(
      `BEGIN DBMS_STATS.GATHER_TABLE_STATS('FIT_ADMIN', '個人'); END;`
    );
    log.push("stats gathered (個人)");

    await conn.commit();
    return { ok: true, steps: log };
  } catch (err) {
    console.error("post-restore-setup error", err);
    return { ok: false, steps: log, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// 契約形態(会員区分に紐づく)抽出のためのテーブル名確認 + grant。
// FIT_ADMIN 配下の 契約/形態/明細 系テーブルを列挙し、候補に一致するものへ
// knowbie_ro に SELECT grant を付与する。
async function grantContractForms(adminCfg, roCfg) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });
  const out = { candidatesFound: [], granted: [], errors: [] };
  try {
    const r = await conn.execute(
      `SELECT table_name FROM all_tables
        WHERE owner = 'FIT_ADMIN'
          AND (table_name LIKE '%契約形態%' OR table_name LIKE '%契約明細%'
               OR table_name LIKE '%会員契約%')
        ORDER BY table_name`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    out.candidatesFound = (r.rows || []).map((x) => x.TABLE_NAME);
    // 実在するもののうち、契約形態抽出 / 返金の口座 に必要なテーブルを grant
    const need = ["会員契約明細", "契約形態", "会員契約者口座"];
    for (const tbl of need) {
      if (!out.candidatesFound.includes(tbl)) {
        out.errors.push(`${tbl}: not found in FIT_ADMIN`);
        continue;
      }
      try {
        await conn.execute(`GRANT SELECT ON FIT_ADMIN."${tbl}" TO ${roCfg.user}`);
        out.granted.push(tbl);
      } catch (e) {
        out.errors.push(`${tbl}: ${e.message}`);
      }
    }
    await conn.commit();
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, ...out, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// FIT_ADMIN 配下のテーブルを管理者権限で探索する (grant前の名称確認用)。
// - 振替サマリ(月次処理)の JOIN 先候補: 商品/税/委託先/クラブ情報/振替結果
// - 会員別 入館/来館ログ候補: 入館/来館/入退館/利用 系
async function discover(adminCfg) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });
  try {
    const r = await conn.execute(
      `SELECT table_name AS NAME FROM all_tables
        WHERE owner = 'FIT_ADMIN'
          AND (table_name IN ('商品','税','委託先','クラブ情報','振替結果')
               OR table_name LIKE '%入館%' OR table_name LIKE '%来館%' OR table_name LIKE '%入退館%'
               OR table_name LIKE '%入退室%' OR table_name LIKE '%利用履歴%' OR table_name LIKE '%利用実績%'
               OR table_name LIKE '%利用トラン%' OR table_name LIKE '%入館トラン%')
        ORDER BY table_name`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return { ok: true, tables: (r.rows || []).map((x) => x.NAME) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// 指定テーブルの列名/型を管理者権限で取得 (SQL組み立て前の型確認用)。
// event.columns = [{table, column}]  → data_type を返す
async function describeColumns(adminCfg, cols) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });
  try {
    const out = [];
    for (const { table, column } of cols) {
      const r = await conn.execute(
        `SELECT column_name AS NAME, data_type AS TYPE, data_length AS LEN FROM all_tab_columns
          WHERE owner='FIT_ADMIN' AND table_name = :t AND column_name LIKE :c ORDER BY column_name`,
        { t: table, c: `%${column}%` },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      out.push({ table, query: column, columns: (r.rows || []).map((x) => ({ name: x.NAME, type: x.TYPE, len: x.LEN })) });
    }
    return { ok: true, described: out };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// 指定テーブルのインデックス(列構成)を管理者権限で取得。event.table
async function listIndexes(adminCfg, table) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });
  try {
    const r = await conn.execute(
      `SELECT i.index_name AS IDX, c.column_name AS COL, c.column_position AS POS
         FROM all_indexes i JOIN all_ind_columns c
           ON c.index_owner = i.owner AND c.index_name = i.index_name
        WHERE i.table_owner = 'FIT_ADMIN' AND i.table_name = :t
        ORDER BY i.index_name, c.column_position`,
      { t: table }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const byIdx = {};
    for (const x of r.rows || []) { (byIdx[x.IDX] ||= []).push(x.COL); }
    return { ok: true, indexes: Object.entries(byIdx).map(([name, cols]) => ({ name, cols })) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// 指定テーブル名の配列に SELECT を grant する (存在確認付き)。
async function grantTables(adminCfg, roCfg, tables) {
  const conn = await oracledb.getConnection({
    user: adminCfg.user,
    password: adminCfg.password,
    connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
  });
  const out = { granted: [], errors: [] };
  try {
    for (const tbl of tables) {
      try {
        await conn.execute(`GRANT SELECT ON FIT_ADMIN."${tbl}" TO ${roCfg.user}`);
        out.granted.push(tbl);
      } catch (e) {
        out.errors.push(`${tbl}: ${e.message}`);
      }
    }
    await conn.commit();
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, ...out, error: err.message };
  } finally {
    try { await conn.close(); } catch (_) { /* noop */ }
  }
}

// --- メインハンドラ ----------------------------------------------------------
export const handler = async (event) => {
  console.log("trigger event", JSON.stringify(event));

  const adminCfg = await getSecret(process.env.ORACLE_ADMIN_SECRET_ARN);
  const roCfg    = await getSecret(process.env.ORACLE_RO_SECRET_ARN);

  if (event && event.action === "discover") {
    const r = await discover(adminCfg);
    console.log("discover result", r);
    return r;
  }

  if (event && event.action === "describe" && Array.isArray(event.columns)) {
    const r = await describeColumns(adminCfg, event.columns);
    console.log("describe result", JSON.stringify(r));
    return r;
  }

  if (event && event.action === "indexes" && event.table) {
    const r = await listIndexes(adminCfg, event.table);
    console.log("indexes result", JSON.stringify(r));
    return r;
  }

  // 任意のインデックスを作成(存在時はスキップ)。作成時間を計測して返す。
  // event = { action:"create_index", name, table, cols:"列1,列2" }
  if (event && event.action === "create_index" && event.name && event.table && event.cols) {
    const conn = await oracledb.getConnection({
      user: adminCfg.user, password: adminCfg.password,
      connectString: `${adminCfg.host}:${adminCfg.port}/${adminCfg.service}`,
    });
    try {
      const ex = await exists(conn, `SELECT COUNT(*) FROM all_indexes WHERE owner='FIT_ADMIN' AND index_name = :n`, { n: event.name });
      if (ex) return { ok: true, skipped: "already exists" };
      const t0 = Date.now();
      const colList = String(event.cols).split(",").map((c) => `"${c.trim()}"`).join(", ");
      await conn.execute(`CREATE INDEX FIT_ADMIN.${event.name} ON FIT_ADMIN."${event.table}"(${colList})`);
      await conn.commit();
      return { ok: true, created: event.name, ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally { try { await conn.close(); } catch (_) {} }
  }

  if (event && event.action === "grant_tables" && Array.isArray(event.tables)) {
    const r = await grantTables(adminCfg, roCfg, event.tables);
    console.log("grant_tables result", r);
    return r;
  }

  if (event && event.action === "grant_contract_forms") {
    const r = await grantContractForms(adminCfg, roCfg);
    console.log("grant_contract_forms result", r);
    return r;
  }

  const result = await setup(adminCfg, roCfg);
  console.log("setup result", result);

  // EventBridge から起動された場合は戻り値は使われないが、Step Functions経由なら有効
  return result;
};
