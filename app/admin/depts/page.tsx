"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Dept = {
  deptId: string;
  name: string;
  sortOrder?: number;
  mailingList?: string[];
};

export default function AdminDeptsPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // フォーム用ステート
  const [formDeptId, setFormDeptId] = useState("");
  const [formName, setFormName] = useState("");
  const [formMailingList, setFormMailingList] = useState(""); // カンマ区切り文字列として扱う

  const loadDepts = async () => {
    setLoading(true);
    const res = await fetch("/api/depts");
    const json = await res.json();
    setDepts(json.depts || []);
    setLoading(false);
  };

  useEffect(() => { loadDepts(); }, []);

  const startEdit = (d: Dept) => {
    setEditingId(d.deptId);
    setFormDeptId(d.deptId);
    setFormName(d.name);
    setFormMailingList(d.mailingList?.join(", ") || "");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      deptId: formDeptId,
      name: formName,
      mailingList: formMailingList.split(/[、,]/).map(s => s.trim()).filter(Boolean),
    };

    const res = await fetch("/api/depts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      alert("保存しました");
      setEditingId(null);
      loadDepts();
    }
  };

  if (loading) return <div style={{ padding: 40 }}>読み込み中...</div>;

  return (
    <div className="kb-root">
      {/* ヘッダー部分：戻るボタンを追加 */}
      <div className="kb-topbar">
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: "20px", textDecoration: "none" }}>
          <div className="kb-topbar-left" style={{ display: "flex", alignItems: "center", gap: "20px", cursor: "pointer" }}>
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png" alt="Logo" style={{ width: 48, height: 48, objectFit: "contain" }} />
            <img src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_CR.png" alt="LogoText" style={{ height: 22, objectFit: "contain" }} />
          </div>
        </Link>
        <div className="kb-topbar-center" style={{ fontSize: 18, fontWeight: 700 }}>部署・メーリングリスト管理</div>
        <div className="kb-topbar-right">
          <Link href="/admin"><button className="kb-logout-btn">管理者メニューへ戻る</button></Link>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: 16 }}>
          {/* 一覧 */}
          <section className="kb-admin-card-large" style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #e5e7eb' }}>
            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>部署一覧</h3>
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {depts.map(d => (
                <div 
                  key={d.deptId} 
                  onClick={() => startEdit(d)} 
                  style={{ 
                    padding: '12px', 
                    borderBottom: '1px solid #f1f5f9', 
                    cursor: 'pointer',
                    background: editingId === d.deptId ? '#f0f9ff' : 'transparent',
                    borderRadius: 8,
                    marginBottom: 4
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 14 }}>{d.name}</strong>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, wordBreak: 'break-all' }}>
                    宛先: {d.mailingList?.join(", ") || "未設定"}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 編集フォーム */}
          <section className="kb-admin-card-large" style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #e5e7eb' }}>
            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>
              {editingId ? `「${formName}」を編集` : "部署を選択してください"}
            </h3>
            {editingId ? (
              <form onSubmit={handleSave}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>部署名</label>
                  <input 
                    style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none' }} 
                    value={formName} 
                    onChange={e => setFormName(e.target.value)} 
                    required 
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>メーリングリスト（カンマ区切り）</label>
                  <textarea 
                    style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #d1d5db', height: 120, outline: 'none', resize: 'vertical', fontSize: 14 }} 
                    value={formMailingList} 
                    onChange={e => setFormMailingList(e.target.value)} 
                    placeholder="example1@gmail.com, example2@gmail.com"
                  />
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>※複数のアドレスを入力する場合は半角カンマで区切ってください。</p>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button 
                    type="button" 
                    onClick={() => setEditingId(null)}
                    style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '10px 20px', borderRadius: 999, cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                  >
                    キャンセル
                  </button>
                  <button 
                    type="submit" 
                    style={{ background: '#0ea5e9', color: '#fff', padding: '10px 24px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >
                    保存
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 14 }}>
                左側の一覧から編集する部署を選択してください。
              </div>
            )}
          </section>
        </div>
      </div>

      <style jsx>{`
        .kb-root { min-height: 100vh; background-color: #f8fafc; }
        .kb-topbar { 
          display: flex; 
          align-items: center; 
          justify-content: space-between; 
          padding: 0 24px; 
          height: 72px; 
          background: #fff; 
          border-bottom: 1px solid #e2e8f0; 
        }
        .kb-logout-btn {
          padding: 8px 16px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #475569;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .kb-logout-btn:hover {
          background: #f8fafc;
        }
      `}</style>
    </div>
  );
}