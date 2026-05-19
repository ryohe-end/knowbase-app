"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Wallet, Database, ClipboardCheck, Calculator, Send, ShieldCheck } from "lucide-react";

export default function RefundPaymentTopPage() {
  const shopName = "旭川アモール";
  const shopId = "000121";

  const sections: {
    role: string;
    badge: string;
    icon: React.ReactNode;
    desc: string;
    color: string;
    items: { title: string; href: string; icon: React.ReactNode; bullets: string[] }[];
  }[] = [
    {
      role: "申請する",
      badge: "APPLICANT",
      icon: <Send size={18} />,
      desc: "店舗スタッフが返金・入金の申請を作成します。",
      color: "#0ea5e9",
      items: [
        {
          title: "返金申請",
          href: "/store-settings/refund-payment/refund",
          icon: <RotateCcw size={26} />,
          bullets: ["対象期間の選択", "会員検索 / 返金項目選択", "返金先口座（BankCode連携）", "承認フローへ提出"],
        },
        {
          title: "入金申請",
          href: "/store-settings/refund-payment/deposit",
          icon: <Wallet size={26} />,
          bullets: ["会員選択 / 未納項目一覧", "入金方法・予定日入力", "Oracle 連携登録"],
        },
      ],
    },
    {
      role: "承認する",
      badge: "APPROVER",
      icon: <ShieldCheck size={18} />,
      desc: "店長などの承認者が、申請内容を確認して承認または差戻しを行います。",
      color: "#f59e0b",
      items: [
        {
          title: "返金 承認",
          href: "/store-settings/refund-payment/refund/approver",
          icon: <ClipboardCheck size={26} />,
          bullets: ["承認待ち申請の一覧", "詳細確認 / 承認・差戻し", "差戻しコメント入力"],
        },
        {
          title: "入金 承認",
          href: "/store-settings/refund-payment/deposit/approver",
          icon: <ClipboardCheck size={26} />,
          bullets: ["入金登録の一覧", "金額・予定日の確認", "承認・差戻し"],
        },
      ],
    },
    {
      role: "経理処理",
      badge: "FINANCE",
      icon: <Calculator size={18} />,
      desc: "経理部が最終確認を行い、Oracle側へ実データを反映します。",
      color: "#8b5cf6",
      items: [
        {
          title: "返金 経理処理",
          href: "/store-settings/refund-payment/refund/finance",
          icon: <Calculator size={26} />,
          bullets: ["承認済み申請の最終確認", "振込実行・参照番号登録", "Oracle 売上控除連携"],
        },
        {
          title: "入金 経理処理",
          href: "/store-settings/refund-payment/deposit/finance",
          icon: <Calculator size={26} />,
          bullets: ["入金登録の最終確認", "Oracle 消込処理", "月次サマリ"],
        },
      ],
    },
  ];

  return (
    <div className="rp-root">
      <header className="rp-header">
        <div className="rp-header-inner">
          <div className="rp-brand">
            <Link href="/store-settings" className="rp-back-link">
              <ArrowLeft size={20} />
            </Link>
            <div className="rp-title-group">
              <h1 className="rp-main-title">返金・入金申請</h1>
              <p className="rp-sub-title">{shopId} {shopName}</p>
            </div>
          </div>
          <div className="rp-data-badge">
            <Database size={14} />
            <span>AWS RDS (Oracle) 連携</span>
          </div>
        </div>
      </header>

      <main className="rp-main">
        <div className="rp-container">
          <section className="rp-intro">
            <span className="rp-badge">WORKFLOW</span>
            <h2>ロール別メニュー</h2>
            <p>
              「申請者 → 承認者 → 経理部」の3段階で進行します。あなたのロールに合わせて該当メニューを選択してください。
            </p>
          </section>

          {sections.map((sec) => (
            <section className="rp-role-section" key={sec.role}>
              <div className="rp-role-head" style={{ ["--accent" as any]: sec.color }}>
                <div className="rp-role-head-left">
                  <span className="rp-role-badge" style={{ background: `${sec.color}15`, color: sec.color }}>
                    {sec.icon}
                    <span>{sec.badge}</span>
                  </span>
                  <h3>{sec.role}</h3>
                </div>
                <p>{sec.desc}</p>
              </div>
              <div className="rp-card-grid">
                {sec.items.map((item) => (
                  <Link href={item.href} key={item.title} className="rp-card-link">
                    <div className="rp-card">
                      <div className="rp-card-accent" style={{ background: sec.color }} />
                      <div className="rp-card-body">
                        <div className="rp-card-icon" style={{ color: sec.color, background: `${sec.color}15` }}>
                          {item.icon}
                        </div>
                        <h3>{item.title}</h3>
                        <ul className="rp-card-bullets">
                          {item.bullets.map((b) => (
                            <li key={b} style={{ ["--dot" as any]: sec.color }}>{b}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rp-card-footer" style={{ ["--hover" as any]: sec.color }}>
                        <span>開く</span>
                        <span className="rp-card-arrow">→</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          <section className="rp-notice">
            <div className="rp-notice-title">⚠️ 現在は画面モック</div>
            <p>
              データはダミーです。AWS RDS for Oracle との接続およびワークフロー保存はバックエンド実装後に反映されます。
            </p>
          </section>
        </div>
      </main>

      <style jsx global>{`
        .rp-root { background: #f1f5f9; min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; }
        .rp-header { background: #fff; height: 72px; border-bottom: 2px solid #0ea5e9; position: sticky; top: 0; z-index: 50; }
        .rp-header-inner { max-width: 1240px; margin: 0 auto; height: 100%; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; }
        .rp-brand { display: flex; align-items: center; gap: 20px; }
        .rp-back-link { color: #94a3b8; display: flex; }
        .rp-back-link:hover { color: #0ea5e9; }
        .rp-title-group { line-height: 1.2; }
        .rp-main-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
        .rp-sub-title { font-size: 13px; color: #64748b; font-weight: 600; margin: 0; }
        .rp-data-badge { display: flex; align-items: center; gap: 6px; background: #f0f9ff; color: #0369a1; padding: 6px 12px; border-radius: 20px; border: 1px solid #bae6fd; font-size: 11px; font-weight: 700; }

        .rp-main { padding: 0; }
        .rp-container { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
        .rp-intro { margin-bottom: 32px; }
        .rp-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #0f172a; background: #e0f2fe; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
        .rp-intro h2 { font-size: 26px; font-weight: 800; margin: 0 0 8px 0; }
        .rp-intro p { font-size: 14px; color: #64748b; margin: 0; line-height: 1.6; }

        .rp-role-section { margin-bottom: 40px; }
        .rp-role-head { padding: 14px 18px; background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid var(--accent); border-radius: 12px; margin-bottom: 16px; }
        .rp-role-head-left { display: flex; align-items: center; gap: 12px; }
        .rp-role-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; }
        .rp-role-head h3 { font-size: 18px; font-weight: 800; margin: 0; color: #0f172a; }
        .rp-role-head p { font-size: 13px; color: #64748b; margin: 8px 0 0; line-height: 1.6; }

        .rp-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
        .rp-card-link { text-decoration: none; color: inherit; display: block; }
        .rp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; transition: 0.2s; display: flex; flex-direction: column; height: 100%; }
        .rp-card:hover { transform: translateY(-4px); box-shadow: 0 12px 24px -10px rgba(0,0,0,0.12); border-color: #bae6fd; }
        .rp-card-accent { height: 4px; }
        .rp-card-body { padding: 28px; flex: 1; }
        .rp-card-icon { width: 56px; height: 56px; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-bottom: 18px; }
        .rp-card-body h3 { font-size: 18px; font-weight: 800; margin: 0 0 8px 0; }
        .rp-card-body > p { font-size: 13px; color: #64748b; line-height: 1.7; margin: 0 0 16px 0; }
        .rp-card-bullets { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
        .rp-card-bullets li { font-size: 12px; color: #475569; padding-left: 18px; position: relative; font-weight: 600; }
        .rp-card-bullets li::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--dot); position: absolute; left: 4px; top: 7px; }
        .rp-card-footer { padding: 16px 28px; background: #fafbfc; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: #94a3b8; }
        .rp-card:hover .rp-card-footer { color: #0ea5e9; }
        .rp-card-arrow { font-size: 16px; }

        .rp-notice { margin-top: 32px; padding: 16px 20px; background: #fef9c3; border: 1px solid #fde68a; border-radius: 12px; }
        .rp-notice-title { font-size: 13px; font-weight: 800; color: #92400e; margin-bottom: 4px; }
        .rp-notice p { font-size: 12px; color: #78350f; margin: 0; line-height: 1.5; }
      `}</style>
    </div>
  );
}
