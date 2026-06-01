"use client";

// app/admin/member-search/page.tsx
// 管理者: 会員情報の検索画面 (FIT会員管理DBへの問い合わせ)

import React, { useMemo, useState } from "react";
import Link from "next/link";

type SearchType =
  | "udid"
  | "member_no"
  | "phone"
  | "email"
  | "name_kanji"
  | "name_kana";

type Row = {
  kojinSeq: string | null;
  memberNo: string | null;
  nameKanji: string | null;
  nameKanaSei: string | null;
  nameKanaMei: string | null;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  udid: string | null;
};

const TYPE_LABELS: Record<SearchType, string> = {
  udid: "UDID",
  member_no: "会員番号",
  phone: "電話番号",
  email: "メールアドレス",
  name_kanji: "漢字氏名",
  name_kana: "カナ氏名 (姓 + 名)",
};

export default function MemberSearchPage() {
  const [type, setType] = useState<SearchType>("member_no");
  const [q, setQ] = useState("");
  const [q2, setQ2] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submittedType, setSubmittedType] = useState<SearchType | null>(null);

  const placeholder = useMemo(() => {
    switch (type) {
      case "udid": return "外部ID (UDID)";
      case "member_no": return "例: 1234567";
      case "phone": return "例: 090-1234-5678";
      case "email": return "例: taro@example.com";
      case "name_kanji": return "例: 山田太郎 (姓名スペース無しで完全一致)";
      case "name_kana": return "姓 (例: ヤマダ)";
    }
  }, [type]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setRows([]);
    setSubmittedType(type);
    try {
      const params = new URLSearchParams({ type, q: q.trim() });
      if (type === "name_kana" && q2.trim()) params.set("q2", q2.trim());
      const res = await fetch(`/api/admin/member-search?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setRows(json.results || []);
    } catch (err: any) {
      setError(err?.message || "unknown_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ms-root">
      <div className="ms-topbar">
        <div className="ms-topbar-inner">
          <Link href="/admin" className="ms-back-btn">← 管理者ダッシュボードに戻る</Link>
          <span className="ms-title">会員情報照会</span>
        </div>
      </div>

      <main className="ms-main">
        <header className="ms-header">
          <div className="ms-badge">MEMBER LOOKUP</div>
          <h1>FIT 会員検索</h1>
          <p>UDID・会員番号・氏名・電話・メールから完全一致で検索します。</p>
        </header>

        <form className="ms-form" onSubmit={onSearch}>
          <div className="ms-form-row">
            <label className="ms-label">
              検索タイプ
              <select
                className="ms-select"
                value={type}
                onChange={(e) => setType(e.target.value as SearchType)}
              >
                {(Object.keys(TYPE_LABELS) as SearchType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>

            <label className="ms-label ms-grow">
              検索値
              <input
                className="ms-input"
                placeholder={placeholder}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
            </label>

            {type === "name_kana" && (
              <label className="ms-label">
                名 (任意)
                <input
                  className="ms-input"
                  placeholder="タロウ"
                  value={q2}
                  onChange={(e) => setQ2(e.target.value)}
                />
              </label>
            )}

            <button className="ms-search-btn" type="submit" disabled={loading || !q.trim()}>
              {loading ? "検索中…" : "検索"}
            </button>
          </div>
        </form>

        {error && (
          <div className="ms-error">エラー: {error}</div>
        )}

        {!error && submittedType && !loading && rows.length === 0 && (
          <div className="ms-empty">ヒットしませんでした。</div>
        )}

        {rows.length > 0 && (
          <div className="ms-results">
            <div className="ms-results-header">
              {rows.length} 件ヒット
              <span className="ms-note">※ メール・電話・UDIDは一部マスク表示</span>
            </div>
            <table className="ms-table">
              <thead>
                <tr>
                  <th>会員番号</th>
                  <th>漢字氏名</th>
                  <th>カナ氏名</th>
                  <th>生年月日</th>
                  <th>メール</th>
                  <th>電話</th>
                  <th>UDID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.kojinSeq}-${r.memberNo}-${i}`}>
                    <td>{r.memberNo ?? "-"}</td>
                    <td>{r.nameKanji ?? "-"}</td>
                    <td>{[r.nameKanaSei, r.nameKanaMei].filter(Boolean).join(" ")}</td>
                    <td>{r.birthday ?? "-"}</td>
                    <td>{r.email ?? "-"}</td>
                    <td>{r.phone ?? "-"}</td>
                    <td>{r.udid ?? "-"}</td>
                    <td>
                      {r.kojinSeq && (
                        <Link
                          href={`/admin/member-search/${r.kojinSeq}`}
                          className="ms-detail-link"
                        >
                          詳細 →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <style jsx global>{`
        .ms-root {
          min-height: 100vh;
          background: #fcfdfe;
          color: #0f172a;
          font-family: "Inter", -apple-system, sans-serif;
        }
        .ms-topbar {
          height: 56px;
          background: rgba(255, 255, 255, 0.9);
          border-bottom: 1px solid #e2e8f0;
          position: sticky;
          top: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
        }
        .ms-topbar-inner {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ms-back-btn {
          background: #fff;
          border: 1px solid #e2e8f0;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          text-decoration: none;
          transition: 0.2s;
        }
        .ms-back-btn:hover {
          color: #06b6d4;
          border-color: #06b6d4;
        }
        .ms-title {
          font-size: 14px;
          font-weight: 700;
          color: #475569;
        }
        .ms-main {
          max-width: 1140px;
          margin: 0 auto;
          padding: 48px 24px;
        }
        .ms-header { margin-bottom: 32px; }
        .ms-badge {
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
        .ms-header h1 {
          font-size: 28px;
          font-weight: 800;
          margin: 0 0 4px;
        }
        .ms-header p {
          font-size: 14px;
          color: #64748b;
          margin: 0;
        }

        .ms-form {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 24px;
          margin-bottom: 24px;
        }
        .ms-form-row {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .ms-label {
          display: flex;
          flex-direction: column;
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          gap: 6px;
          min-width: 160px;
        }
        .ms-grow { flex: 1; min-width: 240px; }
        .ms-select, .ms-input {
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 14px;
          color: #0f172a;
          background: #fff;
        }
        .ms-input:focus, .ms-select:focus {
          outline: 2px solid #06b6d4;
          outline-offset: -1px;
          border-color: transparent;
        }
        .ms-search-btn {
          background: #06b6d4;
          color: #fff;
          border: none;
          padding: 11px 24px;
          font-size: 14px;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          height: 42px;
        }
        .ms-search-btn:disabled {
          background: #cbd5e1;
          cursor: not-allowed;
        }
        .ms-search-btn:not(:disabled):hover { background: #0891b2; }

        .ms-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
        }
        .ms-empty {
          padding: 32px;
          text-align: center;
          color: #94a3b8;
          font-size: 14px;
        }

        .ms-results {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          overflow: hidden;
        }
        .ms-results-header {
          padding: 16px 20px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          font-size: 13px;
          font-weight: 700;
          color: #475569;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ms-note {
          font-size: 11px;
          font-weight: 500;
          color: #94a3b8;
        }
        .ms-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .ms-table th, .ms-table td {
          padding: 12px 16px;
          text-align: left;
          border-bottom: 1px solid #f1f5f9;
        }
        .ms-table th {
          background: #fafbfc;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.05em;
        }
        .ms-table tr:hover td { background: #fcfdfe; }
        .ms-detail-link {
          color: #06b6d4;
          text-decoration: none;
          font-weight: 700;
          font-size: 12px;
        }
        .ms-detail-link:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
