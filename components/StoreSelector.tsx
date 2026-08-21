"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";

type StoreEntry = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
  address: string;
  isActive: boolean;
  capacity?: number;
  company?: string;      // カンパニー (ヤマウチ 等)
  companyGroup?: string; // 運営部 (EAST/WEST/NORTH/SOUTH/FC(EAST)/WFAP 等)
  areaName?: string;     // エリア (関東 第1エリア 等)
  territory?: string;    // テリトリー (テリトリー1 等)
};

type UserInfo = {
  role: string;
  groupIds: string[];
};

const BRAND_COLORS: Record<string, string> = {
  FIT365: "#f9a8d4",
  JOYFIT: "#3b82f6",
  JOYFIT24: "#dc2626",
  "JOYFIT YOGA": "#16a34a",
  "JOYFIT+": "#1e293b",
};

type Props = {
  /** 店舗選択後の遷移先パス (例: "/store-settings/basic") */
  basePath: string;
  /** ページタイトル */
  title: string;
  /** 戻り先 */
  backHref: string;
  backLabel: string;
};

export default function StoreSelector({ basePath, title, backHref, backLabel }: Props) {
  const [stores, setStores] = useState<StoreEntry[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<Set<string>>(new Set()); // ⑤ 複数選択(空=全ブランド)
  const [companyGroupFilter, setCompanyGroupFilter] = useState<string>("all"); // ④ 運営部
  const [prefectureFilter, setPrefectureFilter] = useState<string>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [hideInactive, setHideInactive] = useState(true);
  const toggleBrand = (b: string) => setBrandFilter((prev) => {
    const next = new Set(prev);
    next.has(b) ? next.delete(b) : next.add(b);
    return next;
  });

  useEffect(() => {
    const fetchStores = async () => {
      try {
        const res = await fetch("/api/store-settings/stores");
        if (res.ok) {
          const data = await res.json();
          setStores(data.stores || []);
          setUserInfo(data.user || null);
          setError(null);
        } else if (res.status === 401) {
          setError("ログインが必要です。再度ログインしてください。");
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `店舗一覧の取得に失敗しました (HTTP ${res.status})`);
        }
      } catch (e) {
        console.error(e);
        setError("店舗一覧の取得に失敗しました。ネットワーク状態を確認してください。");
      } finally {
        setLoading(false);
      }
    };
    fetchStores();
  }, []);

  const brands = useMemo(() => [...new Set(stores.map((s) => s.brand))].sort(), [stores]);
  const companyGroups = useMemo(() => [...new Set(stores.map((s) => s.companyGroup).filter(Boolean) as string[])].sort(), [stores]);
  const prefectures = useMemo(() => [...new Set(stores.map((s) => s.prefecture))].sort(), [stores]);
  const areas = useMemo(() => [...new Set(stores.map((s) => s.areaName).filter(Boolean) as string[])].sort(), [stores]);

  const filtered = useMemo(() => {
    return stores.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          s.clubName.toLowerCase().includes(q) ||
          s.clubCode.toLowerCase().includes(q) ||
          s.prefecture.includes(q) ||
          s.address.includes(q) ||
          (s.company || "").toLowerCase().includes(q) ||
          (s.areaName || "").includes(q) ||
          (s.territory || "").includes(q);
        if (!match) return false;
      }
      if (brandFilter.size > 0 && !brandFilter.has(s.brand)) return false;
      if (companyGroupFilter !== "all" && s.companyGroup !== companyGroupFilter) return false;
      if (prefectureFilter !== "all" && s.prefecture !== prefectureFilter) return false;
      if (areaFilter !== "all" && s.areaName !== areaFilter) return false;
      if (hideInactive && !s.isActive) return false;
      return true;
    });
  }, [stores, search, brandFilter, companyGroupFilter, prefectureFilter, areaFilter, hideInactive]);

  const activeCount = stores.filter((s) => s.isActive).length;

  return (
    <div className="sl-root">
      <header className="sl-header">
        <div className="sl-header-inner">
          <Link href={backHref} className="sl-back-link">← {backLabel}</Link>
          <h1 className="sl-page-title">{title}</h1>
          <div className="sl-header-right">
            {userInfo && (
              <span className={`sl-role-badge ${userInfo.role}`}>
                {userInfo.role === "admin" ? "管理者" : "閲覧者"}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="sl-main">
        <div className="sl-subtitle">設定する店舗を選択してください</div>

        <div className="sl-summary">
          <div className="sl-summary-item">
            <span className="sl-summary-num">{stores.length}</span>
            <span className="sl-summary-label">全店舗</span>
          </div>
          <div className="sl-summary-item">
            <span className="sl-summary-num active">{activeCount}</span>
            <span className="sl-summary-label">稼働中</span>
          </div>
          <div className="sl-summary-item">
            <span className="sl-summary-num inactive">{stores.length - activeCount}</span>
            <span className="sl-summary-label">停止中</span>
          </div>
          <div className="sl-summary-item">
            <span className="sl-summary-num">{filtered.length}</span>
            <span className="sl-summary-label">表示中</span>
          </div>
        </div>

        <div className="sl-filters">
          <div className="sl-search-wrap">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sl-search-icon">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="店舗名・クラブコード・住所で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sl-search-input"
            />
            {search && <button className="sl-search-clear" onClick={() => setSearch("")}>×</button>}
          </div>
          <div className="sl-brand-chips" role="group" aria-label="ブランド(複数選択可)">
            <button
              type="button"
              className={`sl-brand-chip ${brandFilter.size === 0 ? "active" : ""}`}
              onClick={() => setBrandFilter(new Set())}
            >全ブランド</button>
            {brands.map((b) => (
              <button
                type="button"
                key={b}
                className={`sl-brand-chip ${brandFilter.has(b) ? "active" : ""}`}
                onClick={() => toggleBrand(b)}
                style={brandFilter.has(b) ? { borderColor: BRAND_COLORS[b] || "#3b82f6", color: BRAND_COLORS[b] || "#1d4ed8" } : undefined}
              >{b}</button>
            ))}
          </div>
          {companyGroups.length > 0 && (
            <select value={companyGroupFilter} onChange={(e) => setCompanyGroupFilter(e.target.value)} className="sl-filter-select" title="運営部">
              <option value="all">全運営部</option>
              {companyGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <select value={prefectureFilter} onChange={(e) => setPrefectureFilter(e.target.value)} className="sl-filter-select">
            <option value="all">全都道府県</option>
            {prefectures.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {areas.length > 0 && (
            <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="sl-filter-select">
              <option value="all">全エリア</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <label className="sl-checkbox-label">
            <input type="checkbox" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} className="sl-checkbox" />
            停止中を除外
          </label>
        </div>

        {error && (
          <div className="sl-error-banner">
            <span className="sl-error-icon">!</span>
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="sl-loading">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="sl-empty">
            <div className="sl-empty-text">条件に一致する店舗がありません</div>
            <button className="sl-empty-btn" onClick={() => { setSearch(""); setBrandFilter(new Set()); setCompanyGroupFilter("all"); setPrefectureFilter("all"); setAreaFilter("all"); setHideInactive(false); }}>
              フィルターをリセット
            </button>
          </div>
        ) : (
          <div className="sl-table-wrap">
            <table className="sl-table">
              <thead>
                <tr>
                  <th>クラブコード</th>
                  <th>店舗名</th>
                  <th>ブランド</th>
                  <th>業態</th>
                  <th>運営部</th>
                  <th>エリア</th>
                  <th>テリトリー</th>
                  <th>カンパニー</th>
                  <th>都道府県</th>
                  <th>ステータス</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((store) => (
                  <tr key={store.clubCode} className={!store.isActive ? "inactive-row" : ""}>
                    <td><code className="sl-code">{store.clubCode}</code></td>
                    <td className="sl-td-name">{store.clubName}</td>
                    <td>
                      <span className="sl-brand-badge" style={{ borderColor: BRAND_COLORS[store.brand] || "#94a3b8", color: BRAND_COLORS[store.brand] || "#64748b" }}>
                        {store.brand}
                      </span>
                    </td>
                    <td><span className="sl-biz-type">{store.businessType}</span></td>
                    <td>{store.companyGroup ? <span className="sl-area">{store.companyGroup}</span> : <span className="sl-dash">—</span>}</td>
                    <td>{store.areaName ? <span className="sl-area">{store.areaName}</span> : <span className="sl-dash">—</span>}</td>
                    <td>{store.territory ? <span className="sl-territory">{store.territory}</span> : <span className="sl-dash">—</span>}</td>
                    <td>{store.company ? <span className="sl-company">{store.company}</span> : <span className="sl-dash">—</span>}</td>
                    <td>{store.prefecture}</td>
                    <td>
                      {store.isActive
                        ? <span className="sl-status-badge active">稼働中</span>
                        : <span className="sl-status-badge inactive">停止中</span>}
                    </td>
                    <td>
                      <Link href={`${basePath}?clubCode=${store.clubCode}`} className="sl-open-btn">
                        選択
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <style jsx global>{`
        .sl-root {
          background: linear-gradient(160deg, #f0f4ff 0%, #f8fafc 40%, #faf5ff 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
        }
        .sl-header {
          height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226,232,240,0.8); position: sticky; top: 0; z-index: 200;
        }
        .sl-header-inner { max-width: 1280px; margin: 0 auto; padding: 0 24px; height: 100%; display: flex; align-items: center; justify-content: space-between; }
        .sl-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 12px; border-radius: 8px; transition: 0.15s; }
        .sl-back-link:hover { background: #f1f5f9; color: #334155; }
        .sl-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; }
        .sl-header-right { display: flex; align-items: center; gap: 12px; }
        .sl-role-badge { font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 99px; }
        .sl-role-badge.admin { background: linear-gradient(135deg,#eff6ff,#dbeafe); color: #1d4ed8; border: 1px solid #93c5fd; }
        .sl-role-badge.viewer { background: linear-gradient(135deg,#f5f3ff,#ede9fe); color: #6d28d9; border: 1px solid #c4b5fd; }
        .sl-main { max-width: 1280px; margin: 0 auto; padding: 28px 24px 80px; }
        .sl-subtitle { font-size: 14px; color: #64748b; margin-bottom: 20px; }

        .sl-summary { display: flex; gap: 16px; margin-bottom: 24px; }
        .sl-summary-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 24px; display: flex; flex-direction: column; gap: 4px; min-width: 120px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .sl-summary-num { font-size: 28px; font-weight: 800; color: #1e293b; line-height: 1; }
        .sl-summary-num.active { color: #059669; }
        .sl-summary-num.inactive { color: #dc2626; }
        .sl-summary-label { font-size: 12px; font-weight: 600; color: #94a3b8; }

        .sl-filters { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
        .sl-search-wrap { flex: 1; min-width: 280px; position: relative; display: flex; align-items: center; }
        .sl-search-icon { position: absolute; left: 14px; color: #94a3b8; pointer-events: none; }
        .sl-search-input { width: 100%; padding: 10px 36px 10px 40px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 14px; background: #fff; outline: none; transition: 0.15s; }
        .sl-search-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.08); }
        .sl-search-clear { position: absolute; right: 10px; width: 22px; height: 22px; border-radius: 50%; background: #e2e8f0; border: none; color: #64748b; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .sl-filter-select { padding: 10px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 13px; font-weight: 600; background: #fff; color: #475569; outline: none; cursor: pointer; transition: 0.15s; min-width: 140px; }
        .sl-filter-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.08); }
        .sl-brand-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .sl-brand-chip { padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 12px; font-weight: 700; background: #fff; color: #64748b; cursor: pointer; transition: 0.15s; }
        .sl-brand-chip:hover { border-color: #cbd5e1; background: #f8fafc; }
        .sl-brand-chip.active { border-color: #3b82f6; color: #1d4ed8; background: #eff6ff; }
        .sl-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; white-space: nowrap; padding: 0 4px; }
        .sl-checkbox { width: 16px; height: 16px; accent-color: #3b82f6; cursor: pointer; }

        .sl-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02), 0 4px 16px rgba(0,0,0,0.02); }
        .sl-table { width: 100%; border-collapse: collapse; }
        .sl-table th { background: #f8fafc; text-align: left; padding: 12px 20px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; }
        .sl-table td { padding: 14px 20px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .sl-table tr:last-child td { border-bottom: none; }
        .sl-table tbody tr { transition: background 0.1s; }
        .sl-table tbody tr:hover { background: #f8fafc; }
        .sl-table tr.inactive-row { opacity: 0.55; }

        .sl-code { background: #f1f5f9; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-family: "SF Mono", monospace; color: #475569; font-weight: 600; }
        .sl-td-name { font-weight: 700; color: #1e293b; }
        .sl-brand-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; border: 1.5px solid; background: #fff; }
        .sl-biz-type { font-size: 12px; color: #64748b; }
        .sl-area { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; background: #eef2ff; color: #4338ca; white-space: nowrap; }
        .sl-territory { font-size: 12px; color: #475569; white-space: nowrap; }
        .sl-company { font-size: 12px; color: #334155; white-space: nowrap; }
        .sl-dash { color: #cbd5e1; }
        .sl-status-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }
        .sl-status-badge.active { background: #ecfdf5; color: #059669; }
        .sl-status-badge.inactive { background: #fef2f2; color: #dc2626; }
        .sl-open-btn { display: inline-block; padding: 6px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; color: #3b82f6; background: #eff6ff; text-decoration: none; transition: 0.15s; white-space: nowrap; }
        .sl-open-btn:hover { background: #dbeafe; color: #1d4ed8; }

        .sl-loading { text-align: center; padding: 80px 24px; color: #94a3b8; font-size: 14px; }
        .sl-error-banner { display: flex; align-items: center; gap: 12px; background: linear-gradient(135deg,#fef2f2,#fee2e2); border: 1px solid #fca5a5; color: #b91c1c; padding: 14px 20px; border-radius: 12px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
        .sl-error-icon { width: 22px; height: 22px; border-radius: 50%; background: #dc2626; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; }
        .sl-empty { text-align: center; padding: 80px 24px; }
        .sl-empty-text { font-size: 14px; color: #94a3b8; margin-bottom: 16px; }
        .sl-empty-btn { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; transition: 0.15s; }
        .sl-empty-btn:hover { background: #e2e8f0; }
      `}</style>
    </div>
  );
}
