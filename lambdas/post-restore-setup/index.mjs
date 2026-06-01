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

// 既存判定用ヘルパ
async function exists(conn, sql, binds) {
  const r = await conn.execute(sql, binds);
  return (r.rows?.[0]?.[0] ?? 0) > 0;
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
    for (const tbl of ["個人", "会員番号", "会員番号_外部ID", "個人電話番号"]) {
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

// --- メインハンドラ ----------------------------------------------------------
export const handler = async (event) => {
  console.log("trigger event", JSON.stringify(event));

  const adminCfg = await getSecret(process.env.ORACLE_ADMIN_SECRET_ARN);
  const roCfg    = await getSecret(process.env.ORACLE_RO_SECRET_ARN);

  const result = await setup(adminCfg, roCfg);
  console.log("setup result", result);

  // EventBridge から起動された場合は戻り値は使われないが、Step Functions経由なら有効
  return result;
};
