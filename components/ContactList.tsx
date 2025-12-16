// ContactList.tsx

"use client";

import type { Contact } from "@/types/contact";
import type { Dept } from "@/types/dept";

type Props = {
  contacts: Contact[];
  contactSearch: string;
  setContactSearch: (v: string) => void;
  deptMap: Record<string, Dept>;
  loading: boolean;
};

// 問い合わせボタン用（必要に応じて本番アドレスへ変更）
const INQUIRY_MAIL = "support@example.com";

export default function ContactList({
  contacts,
  contactSearch,
  setContactSearch,
  deptMap,
  loading,
}: Props) {
  return (
    <aside className="kb-panel">
      <div className="kb-panel-header-row">
        <div className="kb-panel-title">担当者リスト</div>
      </div>

      <button
        type="button"
        className="kb-primary-btn"
        style={{ width: "100%", marginBottom: 8 }}
        onClick={() => {
          const mail = INQUIRY_MAIL;
          window.location.href = `mailto:${mail}?subject=${encodeURIComponent(
            "[Know Base] お問い合わせ"
          )}`;
        }}
      >
        問い合わせ
      </button>

      <input
        className="kb-small-input"
        placeholder="担当業務や名前・メールで検索"
        type="text"
        value={contactSearch}
        onChange={(e) => setContactSearch(e.target.value)}
      />

      <div className="kb-contact-list">
        {loading && <div>読み込み中...</div>}

        {!loading && contacts.length === 0 && (
          <div className="kb-subnote">該当する担当者がいません。</div>
        )}

        {!loading &&
          contacts.map((c) => {
            const deptName = deptMap[c.deptId]?.name ?? "";
            const initial = c.name?.charAt(0) ?? "?";

            // Gmailへのメール送信URLを構築
            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${c.email}&subject=${encodeURIComponent(
              "[Know Base] お問い合わせ"
            )}`;

            return (
              <div className="kb-contact-item" key={c.contactId}>
                <div className="kb-contact-avatar">{initial}</div>
                
                {/* kb-contact-body が相対配置の親要素になります (CSSで設定) */}
                <div className="kb-contact-body">
                  <div className="kb-contact-name">{c.name}</div>
                  <div className="kb-contact-dept">{deptName}</div>
                  
                  {/* ★ 修正箇所：メールアドレスの行全体を Flexbox でラップ ★ */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '30px' }}>
                      
                      {/* 元のメールアドレスリンク (テキスト) */}
                      <a className="kb-contact-mail" href={`mailto:${c.email}`}>
                          {c.email}
                      </a>
                      
                      {/* 新しい PNG アイコンボタン (絶対配置で配置されます) */}
                      <a 
                          className="kb-contact-mail-btn-new" 
                          href={gmailUrl}
                          target="_blank" 
                          rel="noopener noreferrer" 
                          title="メール送信 (Gmail)" 
                          aria-label="メール送信 (Gmail)"
                      >
                          <img
                              src="https://houjin-manual.s3.us-east-2.amazonaws.com/gmail-new.png"
                              alt="Gmail送信アイコン"
                              style={{ width: 18, height: 18, display: 'block' }} 
                          />
                      </a>
                  </div>
                  {/* ★ 修正ここまで ★ */}
                  
                </div>
              </div>
            );
          })}
      </div>
    </aside>
  );
}