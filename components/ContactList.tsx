// components/ContactList.tsx
"use client";

import { useMemo } from "react";
import type { Contact } from "@/types/contact";
import type { Dept } from "@/types/dept";

type Props = {
  contacts: Contact[]; // ← brand/dept で絞ったものを page.tsx から渡す想定
  contactSearch: string;
  setContactSearch: (v: string) => void;
  deptMap: Record<string, Dept>;
  loading: boolean;
};

const INQUIRY_MAIL = "support@example.com";

type ContactHit = {
  fields: Array<"name" | "email" | "role" | "dept" | "tag">;
  tags: string[];
};

function labelOfField(f: ContactHit["fields"][number]) {
  if (f === "name") return "名前";
  if (f === "email") return "メール";
  if (f === "role") return "役割";
  if (f === "dept") return "部署";
  if (f === "tag") return "タグ";
  return "";
}

function highlightText(text: string, kwRaw: string) {
  const kw = kwRaw.trim();
  if (!kw) return text;

  const lower = text.toLowerCase();
  const k = kw.toLowerCase();
  const idx = lower.indexOf(k);
  if (idx < 0) return text;

  const before = text.slice(0, idx);
  const hit = text.slice(idx, idx + kw.length);
  const after = text.slice(idx + kw.length);

  return (
    <>
      {before}
      <span className="kb-hit-value">{hit}</span>
      {after}
    </>
  );
}

export default function ContactList({
  contacts,
  contactSearch,
  setContactSearch,
  deptMap,
  loading,
}: Props) {
  const searching = !!contactSearch.trim();
  const kw = contactSearch.trim().toLowerCase();

  const viewContacts = useMemo(() => {
    return (contacts || [])
      .map((c) => {
        const deptLabel = deptMap[c.deptId]?.name ?? "";
        const role = c.role ?? "";
        const tags = c.tags ?? [];

        if (!kw) return { ...c, hit: { fields: [], tags: [] } as ContactHit };

        const hit: ContactHit = { fields: [], tags: [] };

        if ((c.name ?? "").toLowerCase().includes(kw)) hit.fields.push("name");
        if ((c.email ?? "").toLowerCase().includes(kw)) hit.fields.push("email");
        if (role.toLowerCase().includes(kw)) hit.fields.push("role");
        if (deptLabel.toLowerCase().includes(kw)) hit.fields.push("dept");

        const hitTags = tags.filter((t) => (t ?? "").toLowerCase().includes(kw));
        if (hitTags.length) {
          hit.fields.push("tag");
          hit.tags = hitTags;
        }

        if (hit.fields.length === 0) return null;
        return { ...c, hit };
      })
      .filter((v): v is Contact & { hit: ContactHit } => v !== null);
  }, [contacts, deptMap, kw]);

  return (
    <aside className="kb-panel">
      <div className="kb-panel-header-row">
        <div className="kb-panel-title">担当者リスト</div>
      </div>

      {/* 問い合わせ（謎ボタンは出さない。これだけ） */}
      <button
        type="button"
        className="kb-primary-btn"
        style={{ width: "100%", marginBottom: 8 }}
        onClick={() => {
          window.open(
            `https://mail.google.com/mail/?view=cm&fs=1&to=${INQUIRY_MAIL}&su=${encodeURIComponent(
              "[Know Base] お問い合わせ"
            )}`,
            "_blank"
          );
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

        {!loading && viewContacts.length === 0 && (
          <div className="kb-subnote">該当する担当者がいません。</div>
        )}

        {!loading &&
          viewContacts.map((c) => {
            const deptLabel = deptMap[c.deptId]?.name ?? "";
            const initial = (c.name ?? "?").charAt(0);

            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
              c.email
            )}&su=${encodeURIComponent("[Know Base] お問い合わせ")}`;

            const hitLabels =
              searching && c.hit?.fields?.length ? c.hit.fields.map(labelOfField).filter(Boolean) : [];

            return (
              <div className="kb-contact-item" key={c.contactId}>
                <div className="kb-contact-avatar">{initial}</div>

                <div className="kb-contact-body">
                  <div className="kb-contact-name">
                    {searching ? highlightText(c.name ?? "", contactSearch) : c.name}
                  </div>

                  <div className="kb-contact-dept">
                    {searching ? highlightText(deptLabel, contactSearch) : deptLabel}
                  </div>

                  {!!c.role && (
                    <div className="kb-contact-dept">
                      {searching ? highlightText(c.role ?? "", contactSearch) : c.role}
                    </div>
                  )}

                  {/* メール行：必ず1行 + 右にアイコン */}
                  <div className="kb-contact-mail-row">
                    <a
                      className="kb-contact-mail"
                      href={`mailto:${c.email}`}
                      title={c.email}
                    >
                      {searching ? highlightText(c.email ?? "", contactSearch) : c.email}
                    </a>

                    <a
                      className="kb-contact-mail-btn"
                      href={gmailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="メール送信 (Gmail)"
                      aria-label="メール送信 (Gmail)"
                    >
                      <img
                        src="https://houjin-manual.s3.us-east-2.amazonaws.com/gmail-new.png"
                        alt=""
                        width={18}
                        height={18}
                        style={{ display: "block" }}
                      />
                    </a>
                  </div>

                  {/* ヒット情報 */}
                  {searching && (hitLabels.length > 0 || (c.hit?.tags?.length ?? 0) > 0) && (
                    <div className="kb-contact-hit-fields">
                      <span style={{ marginRight: 6 }}>ヒット：</span>

                      {hitLabels.map((t, i) => (
                        <span className="kb-hit-field" key={`f-${i}`}>
                          {t}
                        </span>
                      ))}

                      {c.hit?.tags?.map((t, i) => (
                        <span className="kb-hit-tag" key={`t-${i}`}>
                          #{highlightText(t, contactSearch)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </aside>
  );
}
