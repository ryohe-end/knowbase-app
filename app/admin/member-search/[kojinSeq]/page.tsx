"use client";

// app/admin/member-search/[kojinSeq]/page.tsx
// 管理者: 会員詳細表示 (個人SEQ単位)
// マスキング無しのフル情報を表示する。閲覧時に view 監査ログが残る。

import React, { useEffect, useState, use } from "react";
import Link from "next/link";

type Member = {
  kojinSeq: string | null;
  memberNo: string | null;
  nameKanji: string | null;
  nameKanaSei: string | null;
  nameKanaMei: string | null;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  udid: string | null;
  udidDeleted: boolean;
};

export default function MemberDetailPage({
  params,
}: {
  params: Promise<{ kojinSeq: string }>;
}) {
  const { kojinSeq } = use(params);
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/admin/member-search/${kojinSeq}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error || `HTTP ${res.status}`);
          return;
        }
        setRows(json.member || []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "unknown_error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kojinSeq]);

  const head = rows[0];

  return (
    <div className="md-root">
      <div className="md-topbar">
        <div className="md-topbar-inner">
          <Link href="/admin/member-search" className="md-back-btn">← 検索に戻る</Link>
          <span className="md-title">会員詳細</span>
        </div>
      </div>

      <main className="md-main">
        {loading && <div className="md-loading">読み込み中…</div>}

        {error && <div className="md-error">エラー: {error}</div>}

        {!loading && !error && head && (
          <>
            <header className="md-header">
              <div className="md-badge">MEMBER DETAIL</div>
              <h1>{head.nameKanji ?? "(氏名なし)"}</h1>
              <p>個人SEQ: {head.kojinSeq}</p>
            </header>

            <section className="md-card">
              <h2>基本情報</h2>
              <dl className="md-dl">
                <dt>漢字氏名</dt><dd>{head.nameKanji ?? "-"}</dd>
                <dt>カナ姓</dt><dd>{head.nameKanaSei ?? "-"}</dd>
                <dt>カナ名</dt><dd>{head.nameKanaMei ?? "-"}</dd>
                <dt>生年月日</dt><dd>{head.birthday ?? "-"}</dd>
                <dt>メールアドレス</dt><dd>{head.email ?? "-"}</dd>
                <dt>主要電話番号</dt><dd>{head.phone ?? "-"}</dd>
              </dl>
            </section>

            <section className="md-card">
              <h2>紐づく会員番号 / UDID ({rows.length} 件)</h2>
              <table className="md-table">
                <thead>
                  <tr>
                    <th>会員番号</th>
                    <th>UDID (外部ID)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.memberNo}-${r.udid}-${i}`}>
                      <td>{r.memberNo ?? "-"}</td>
                      <td className="md-mono">
                        {r.udid ?? "-"}
                        {r.udidDeleted && (
                          <span
                            style={{
                              marginLeft: 6,
                              padding: "1px 6px",
                              fontSize: 11,
                              borderRadius: 10,
                              background: "#fee2e2",
                              color: "#991b1b",
                              verticalAlign: "middle",
                            }}
                          >
                            削除済
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>

      <style jsx global>{`
        .md-root {
          min-height: 100vh;
          background: #fcfdfe;
          color: #0f172a;
          font-family: "Inter", -apple-system, sans-serif;
        }
        .md-topbar {
          height: 56px;
          background: rgba(255, 255, 255, 0.9);
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
        }
        .md-topbar-inner {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .md-back-btn {
          background: #fff;
          border: 1px solid #e2e8f0;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          text-decoration: none;
        }
        .md-back-btn:hover { color: #06b6d4; border-color: #06b6d4; }
        .md-title {
          font-size: 14px;
          font-weight: 700;
          color: #475569;
        }
        .md-main {
          max-width: 960px;
          margin: 0 auto;
          padding: 48px 24px;
        }
        .md-loading, .md-error {
          padding: 32px;
          text-align: center;
        }
        .md-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          border-radius: 8px;
          font-weight: 600;
        }
        .md-header { margin-bottom: 32px; }
        .md-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.15em;
          color: #06b6d4;
          background: #ecfeff;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 12px;
        }
        .md-header h1 {
          font-size: 28px;
          font-weight: 800;
          margin: 0 0 4px;
        }
        .md-header p {
          font-size: 13px;
          color: #94a3b8;
          margin: 0;
        }
        .md-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 24px 28px;
          margin-bottom: 20px;
        }
        .md-card h2 {
          font-size: 14px;
          font-weight: 800;
          color: #475569;
          margin: 0 0 16px;
          letter-spacing: 0.05em;
        }
        .md-dl {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 12px 16px;
          margin: 0;
          font-size: 14px;
        }
        .md-dl dt { color: #64748b; font-weight: 600; }
        .md-dl dd { margin: 0; color: #0f172a; font-weight: 500; }

        .md-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .md-table th, .md-table td {
          padding: 10px 12px;
          text-align: left;
          border-bottom: 1px solid #f1f5f9;
        }
        .md-table th {
          background: #fafbfc;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
        }
        .md-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
