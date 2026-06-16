// scripts/seed-refund-deposit.mjs
//
// 返金 (yamauchi-RefundApplications) と 入金 (yamauchi-DepositApplications) の
// サンプルデータを DynamoDB にワンショット投入する。
//
// 使い方:
//   node scripts/seed-refund-deposit.mjs           # 両方
//   node scripts/seed-refund-deposit.mjs refund    # 返金のみ
//   node scripts/seed-refund-deposit.mjs deposit   # 入金のみ
//
// 必要な環境変数:
//   AWS_REGION (default us-east-1)
//   AWS の認証情報 (aws configure / SSO / 環境変数 いずれか)

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const REFUND_TABLE = process.env.DYNAMO_REFUND_APPLICATIONS_TABLE || "yamauchi-RefundApplications";
const DEPOSIT_TABLE = process.env.DYNAMO_DEPOSIT_APPLICATIONS_TABLE || "yamauchi-DepositApplications";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const NOW = new Date();
function isoMinusDays(days, hour = 10, minute = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function ymd(daysAgo) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function ymMonth(monthsAgo) {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function actedAt(daysAgo, hour = 14, minute = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

const CLUB_CODE = "313";  // 旭川アモール (CSV サンプルに合わせた)
const APPLICANT = { userId: "seed-applicant", userName: "店舗担当 (サンプル)", dept: "旭川アモール 店舗", email: "store@example.com" };
const APPROVER  = { userId: "seed-approver",  userName: "後藤 充洋",            dept: "旭川アモール 店長", email: "goto@example.com" };
const FINANCE   = { userId: "seed-finance",   userName: "経理部 担当",          dept: "本部 経理部",         email: "keiri@example.com" };

// ============ 返金 サンプル ============
const refundSamples = [
  // 1) 承認待ち (申請者完了, 承認者対応中)
  {
    applicationId: `RF-${ymd(2).replace(/-/g, "")}-SEEDD001`,
    clubCode: CLUB_CODE,
    status: "承認待ち",
    memberNo: "3130003649",
    memberName: "横内 みちつな",
    memberKana: "ﾖｺｳﾁ ﾐﾁﾂﾅ",
    memberPlan: "フィットネス",
    targetMonthFrom: ymMonth(2),
    targetMonthTo: ymMonth(1),
    items: [
      { id: "i1", label: "月会費 (先々月分)", amount: 7980 },
      { id: "i2", label: "FIT365あんしんサポート", amount: 550 },
    ],
    totalAmount: 8530,
    reason: "店舗設備の停止による会員からの返金要請。営業時間短縮分も含む。",
    bankAccount: {
      bankCode: "1000",
      bankName: "信用金庫サンプル",
      branchCode: "127100",
      branchName: "旭川支店",
      accountType: "普通",
      accountNumber: "2297908",
      holderName: "ﾖｺｳﾁ ﾐﾁﾂﾅ",
      source: "登録済み（引落口座）",
    },
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了",   actedAt: actedAt(2), comment: "申請しました" },
      { role: "approver",  ...APPROVER,  state: "対応中" },
      { role: "finance",   ...FINANCE,   state: "未対応" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(2), updatedAt: isoMinusDays(2),
  },
  // 2) 経理処理中 (承認者完了, finance 対応中)
  {
    applicationId: `RF-${ymd(5).replace(/-/g, "")}-SEEDD002`,
    clubCode: CLUB_CODE,
    status: "承認待ち",
    memberNo: "3130001234",
    memberName: "山田 太郎",
    memberKana: "ﾔﾏﾀﾞ ﾀﾛｳ",
    memberPlan: "プレミアム",
    targetMonthFrom: ymMonth(1),
    targetMonthTo: ymMonth(1),
    items: [{ id: "i1", label: "月会費 (先月分)", amount: 7980 }],
    totalAmount: 7980,
    reason: "解約日の登録遅延による先月分の返金",
    bankAccount: {
      bankCode: "0001", bankName: "みずほ銀行", branchCode: "813", branchName: "旭川支店",
      accountType: "普通", accountNumber: "1234567", holderName: "ﾔﾏﾀﾞ ﾀﾛｳ",
      source: "登録済み（引落口座）",
    },
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了", actedAt: actedAt(5), comment: "申請しました" },
      { role: "approver",  ...APPROVER,  state: "完了", actedAt: actedAt(4), comment: "解約日確認しました" },
      { role: "finance",   ...FINANCE,   state: "対応中" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(5), updatedAt: isoMinusDays(4),
  },
  // 3) 振込手配中 (経理が CSV 出力済み)
  {
    applicationId: `RF-${ymd(10).replace(/-/g, "")}-SEEDD003`,
    clubCode: CLUB_CODE,
    status: "振込手配中",
    memberNo: "3130002345",
    memberName: "佐藤 花子",
    memberKana: "ｻﾄｳ ﾊﾅｺ",
    memberPlan: "スタンダード",
    targetMonthFrom: ymMonth(2),
    targetMonthTo: ymMonth(2),
    items: [{ id: "i1", label: "事務手数料", amount: 3300 }],
    totalAmount: 3300,
    reason: "重複徴収による事務手数料の返金",
    bankAccount: {
      bankCode: "0116", bankName: "北海道銀行", branchCode: "001", branchName: "本店営業部",
      accountType: "普通", accountNumber: "7654321", holderName: "ｻﾄｳ ﾊﾅｺ",
      source: "登録済み（引落口座）",
    },
    transferBatchId: `BATCH-${ymd(2).replace(/-/g, "")}-1030-SEEDD`,
    transferScheduledDate: ymd(-3),  // 3日後
    transferArrangedAt: isoMinusDays(2, 10, 30),
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了", actedAt: actedAt(10), comment: "申請しました" },
      { role: "approver",  ...APPROVER,  state: "完了", actedAt: actedAt(9), comment: "二重徴収を確認しました" },
      { role: "finance",   ...FINANCE,   state: "対応中" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(10), updatedAt: isoMinusDays(2),
  },
  // 4) 承認済み (振込完了)
  {
    applicationId: `RF-${ymd(20).replace(/-/g, "")}-SEEDD004`,
    clubCode: CLUB_CODE,
    status: "承認済み",
    memberNo: "3130003456",
    memberName: "鈴木 一郎",
    memberKana: "ｽｽﾞｷ ｲﾁﾛｳ",
    memberPlan: "プレミアム",
    targetMonthFrom: ymMonth(3),
    targetMonthTo: ymMonth(3),
    items: [{ id: "i1", label: "月会費 (3ヶ月前分)", amount: 7980 }],
    totalAmount: 7980,
    reason: "店舗都合の臨時休館による返金",
    bankAccount: {
      bankCode: "0005", bankName: "三菱UFJ銀行", branchCode: "201", branchName: "札幌支店",
      accountType: "普通", accountNumber: "2233445", holderName: "ｽｽﾞｷ ｲﾁﾛｳ",
      source: "登録済み（過去返金）",
    },
    transferBatchId: `BATCH-${ymd(15).replace(/-/g, "")}-0900-SEEDD`,
    transferScheduledDate: ymd(10),
    transferArrangedAt: isoMinusDays(15, 9, 0),
    transferAttemptedAt: isoMinusDays(10, 14, 25),
    transferCompletedAt: isoMinusDays(10, 14, 25),
    transferResult: "成功",
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了", actedAt: actedAt(20), comment: "申請しました" },
      { role: "approver",  ...APPROVER,  state: "完了", actedAt: actedAt(19), comment: "確認しました" },
      { role: "finance",   ...FINANCE,   state: "完了", actedAt: actedAt(10, 14, 25), comment: "振込完了" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(20), updatedAt: isoMinusDays(10),
  },
  // 5) 差戻し (経理側で口座番号エラー)
  {
    applicationId: `RF-${ymd(30).replace(/-/g, "")}-SEEDD005`,
    clubCode: CLUB_CODE,
    status: "差戻し",
    memberNo: "3130005678",
    memberName: "田中 健太",
    memberKana: "ﾀﾅｶ ｹﾝﾀ",
    memberPlan: "法人個人A",
    targetMonthFrom: ymMonth(4),
    targetMonthTo: ymMonth(3),
    items: [
      { id: "i1", label: "月会費 (4ヶ月前分)", amount: 5980 },
      { id: "i2", label: "契約ロッカー",      amount: 1100 },
    ],
    totalAmount: 7080,
    reason: "解約日の遡及対応",
    bankAccount: {
      bankCode: "9900", bankName: "ゆうちょ銀行", branchCode: "058", branchName: "〇五八支店",
      accountType: "普通", accountNumber: "8801234", holderName: "ﾀﾅｶ ｹﾝﾀ",
      source: "登録済み（引落口座）",
    },
    transferBatchId: `BATCH-${ymd(25).replace(/-/g, "")}-1010-SEEDD`,
    transferScheduledDate: ymd(20),
    transferArrangedAt: isoMinusDays(25, 10, 10),
    transferAttemptedAt: isoMinusDays(20, 9, 15),
    transferResult: "失敗",
    failureReason: "口座番号相違",
    failureDetail: "全銀ネットからのエラー応答 (受取人口座番号 桁数不一致)",
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了",   actedAt: actedAt(30), comment: "申請しました" },
      { role: "approver",  ...APPROVER,  state: "完了",   actedAt: actedAt(28), comment: "問題ありません" },
      { role: "finance",   ...FINANCE,   state: "差戻し", actedAt: actedAt(20, 9, 15), comment: "振込失敗: 口座番号相違" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(30), updatedAt: isoMinusDays(20),
  },
];

// ============ 入金 サンプル (シンプル: 会員 + 金額 + 予定日 のみ) ============
const depositSamples = [
  // 1) 受付中
  {
    applicationId: `DP-${ymd(1).replace(/-/g, "")}-SEEDD001`,
    clubCode: CLUB_CODE,
    status: "受付中",
    memberNo: "3130003649",
    memberName: "横内 みちつな",
    memberKana: "ﾖｺｳﾁ ﾐﾁﾂﾅ",
    memberPlan: "フィットネス",
    totalAmount: 5280,
    paymentMethod: "銀行振込",
    scheduledDate: ymd(-2),
    memo: "本人から銀行振込連絡あり、明日着金予定",
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了",   actedAt: actedAt(1, 16, 40), comment: "店舗で受付しました" },
      { role: "finance",   ...FINANCE,   state: "対応中" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(1, 16, 40), updatedAt: isoMinusDays(1, 16, 40),
  },
  // 2) 受付中 (複数月まとめての連絡)
  {
    applicationId: `DP-${ymd(3).replace(/-/g, "")}-SEEDD002`,
    clubCode: CLUB_CODE,
    status: "受付中",
    memberNo: "3130004567",
    memberName: "高橋 美咲",
    memberKana: "ﾀｶﾊｼ ﾐｻｷ",
    memberPlan: "1980円会員",
    totalAmount: 7260,
    paymentMethod: "銀行振込",
    scheduledDate: ymd(-3),
    memo: "2か月分まとめて振込予定との連絡あり",
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了",   actedAt: actedAt(3, 11, 20), comment: "店舗で受付しました" },
      { role: "finance",   ...FINANCE,   state: "対応中" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(3, 11, 20), updatedAt: isoMinusDays(3, 11, 20),
  },
  // 3) 消込完了 (バッチ ID 付き → 申請者画面で 入金済+ID 表示)
  {
    applicationId: `DP-${ymd(12).replace(/-/g, "")}-SEEDD003`,
    clubCode: CLUB_CODE,
    status: "消込完了",
    memberNo: "3130008912",
    memberName: "松本 拓海",
    memberKana: "ﾏﾂﾓﾄ ﾀｸﾐ",
    memberPlan: "プレミアム",
    totalAmount: 9080,
    paymentMethod: "現金",
    scheduledDate: ymd(12),
    memo: "来店時に現金で受領、領収書発行済",
    closing: {
      closedAt: isoMinusDays(8, 18, 15),
      receiptDate: ymd(10),
      oracleBatchId: `BATCH-${ymd(10).replace(/-/g, "")}-1815-SEEDD`,
      operator: FINANCE.userName,
      note: "Oracle 消込完了",
    },
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了", actedAt: actedAt(12, 10, 30), comment: "店舗で受付しました" },
      { role: "finance",   ...FINANCE,   state: "完了", actedAt: actedAt(8, 18, 15), comment: "Oracle 消込完了" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(12, 10, 30), updatedAt: isoMinusDays(8, 18, 15),
  },
  // 4) 消込完了 (銀行振込)
  {
    applicationId: `DP-${ymd(25).replace(/-/g, "")}-SEEDD004`,
    clubCode: CLUB_CODE,
    status: "消込完了",
    memberNo: "3130006543",
    memberName: "渡辺 結衣",
    memberKana: "ﾜﾀﾅﾍﾞ ﾕｲ",
    memberPlan: "スタンダード",
    totalAmount: 5980,
    paymentMethod: "銀行振込",
    scheduledDate: ymd(22),
    closing: {
      closedAt: isoMinusDays(21, 11, 0),
      receiptDate: ymd(22),
      oracleBatchId: `BATCH-${ymd(22).replace(/-/g, "")}-1100-SEEDD`,
      operator: FINANCE.userName,
    },
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了", actedAt: actedAt(25, 14, 0), comment: "店舗で受付しました" },
      { role: "finance",   ...FINANCE,   state: "完了", actedAt: actedAt(21, 11, 0), comment: "Oracle 消込完了" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(25, 14, 0), updatedAt: isoMinusDays(21, 11, 0),
  },
  // 5) 差戻し
  {
    applicationId: `DP-${ymd(7).replace(/-/g, "")}-SEEDD005`,
    clubCode: CLUB_CODE,
    status: "差戻し",
    memberNo: "3130009999",
    memberName: "森 健二",
    memberKana: "ﾓﾘ ｹﾝｼﾞ",
    memberPlan: "プレミアム",
    totalAmount: 7980,
    paymentMethod: "クレジット再請求",
    scheduledDate: ymd(-5),
    failureReason: "支払予定日が過去のため要修正",
    failureDetail: "scheduledDate が過去日付。実際の入金見込み日を再設定してください。",
    steps: [
      { role: "applicant", ...APPLICANT, state: "完了",   actedAt: actedAt(7, 11, 30), comment: "店舗で受付しました" },
      { role: "finance",   ...FINANCE,   state: "差戻し", actedAt: actedAt(6, 9, 0),   comment: "差戻し: 支払予定日要修正" },
    ],
    createdBy: APPLICANT.userId, createdByName: APPLICANT.userName,
    createdAt: isoMinusDays(7, 11, 30), updatedAt: isoMinusDays(6, 9, 0),
  },
];

async function putAll(table, items, label) {
  let ok = 0;
  for (const item of items) {
    try {
      await ddb.send(new PutCommand({ TableName: table, Item: item }));
      console.log(`  ✓ ${item.applicationId}`);
      ok += 1;
    } catch (e) {
      console.error(`  ✗ ${item.applicationId}: ${e.message}`);
    }
  }
  console.log(`${label}: ${ok}/${items.length} 件投入完了\n`);
}

async function main() {
  const target = process.argv[2] || "both";
  console.log(`Region: ${REGION}`);
  console.log(`Target: ${target}\n`);

  if (target === "refund" || target === "both") {
    console.log(`▼ ${REFUND_TABLE}`);
    await putAll(REFUND_TABLE, refundSamples, "返金");
  }
  if (target === "deposit" || target === "both") {
    console.log(`▼ ${DEPOSIT_TABLE}`);
    await putAll(DEPOSIT_TABLE, depositSamples, "入金");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
