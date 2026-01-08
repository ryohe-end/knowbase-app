// components/ContactList.tsx
"use client";

import { useMemo } from "react";
import type { Contact } from "@/types/contact";
import type { Dept } from "@/types/dept";

type Props = {
  contacts: Contact[];
  contactSearch: string;
  setContactSearch: (v: string) => void;
  deptMap: Record<string, Dept>;
  loading: boolean;
};

function highlightText(text: string, kwRaw: string) {
  const kw = kwRaw.trim();
  if (!kw) return text;
  const lower = text.toLowerCase();
  const k = kw.toLowerCase();
  const idx = lower.indexOf(k);
  if (idx < 0) return text;
  return (
    <>{text.slice(0, idx)}<span className="kb-hit-value">{text.slice(idx, idx + kw.length)}</span>{text.slice(idx + kw.length)}</>
  );
}

export default function ContactList({ contacts, contactSearch, setContactSearch, deptMap, loading }: Props) {
  const searching = !!contactSearch.trim();
  const kw = contactSearch.trim().toLowerCase();

  return (
    <div className="kb-contact-list-container">
      <input
        className="kb-small-input"
        placeholder="担当業務や名前で検索"
        type="text"
        value={contactSearch}
        onChange={(e) => setContactSearch(e.target.value)}
        style={{ marginBottom: "12px" }}
      />

      <div className="kb-contact-list">
        {loading && <div>読み込み中...</div>}
        {!loading && contacts.length === 0 && <div className="kb-subnote">該当する担当者がいません。</div>}

        {!loading && contacts.map((c: any) => {
          const deptLabel = deptMap[c.deptId]?.name ?? "";
          const initial = (c.name ?? "?").charAt(0);
          const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email)}&su=${encodeURIComponent("[Know Base] お問い合わせ")}`;

          // --- 検索ヒット箇所の判定 ---
          // 名前や部署名以外（role）でヒットしている単語を探す（tagsは含めない）
          let hitInRole = "";
          if (searching && typeof c.role === "string") {
            const roles = c.role.split(/[、,]/);
            const foundRole = roles.find((r: string) => r.toLowerCase().includes(kw));
            if (foundRole) {
              hitInRole = foundRole.trim();
            }
          }

          return (
            <div className="kb-contact-item" key={c.contactId} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px' }}>
              <div className="kb-contact-avatar" style={{ flexShrink: 0 }}>{initial}</div>

              <div className="kb-contact-body" style={{ minWidth: 0, flex: 1 }}>
                {/* 名前行：すぐ右にGmailアイコン */}
                <div className="kb-contact-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {searching ? highlightText(c.name ?? "", contactSearch) : c.name}
                  </span>
                  
                  <a href={gmailUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <img
                      src="https://houjin-manual.s3.us-east-2.amazonaws.com/gmail-new.png"
                      alt="Gmail"
                      width={16}
                      height={16}
                      style={{ cursor: 'pointer', display: 'block' }}
                    />
                  </a>
                </div>

                {/* 部署名：改行禁止 */}
                <div className="kb-contact-dept" style={{ 
                  fontSize: '11px', 
                  color: '#6b7280', 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis',
                  marginTop: '2px'
                }}>
                  {searching ? highlightText(deptLabel, contactSearch) : deptLabel}
                </div>

                {/* ヒットした「担当業務」の索引表示 */}
                {hitInRole && (
                  <div style={{ 
                    marginTop: '4px', 
                    fontSize: '10px', 
                    color: '#0284c7', 
                    background: '#f0f9ff', 
                    display: 'inline-block',
                    padding: '1px 8px',
                    borderRadius: '4px',
                    border: '1px solid #e0f2fe'
                  }}>
                    <span style={{ fontWeight: 'bold' }}>ヒット:</span> {highlightText(hitInRole, contactSearch)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}