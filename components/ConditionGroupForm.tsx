// components/ConditionGroupForm.tsx
// Push/DM の会員抽出「条件グループ」1個分のフォーム。グループ内はすべて AND。
// push/dm でクラス接頭辞(cls)だけ差し替えて共用する。
"use client";

import React from "react";
import ContractTypePicker, { type ContractTypeOption } from "./ContractTypePicker";

export type CondGroup = {
  joinDateFrom: string;
  joinDateTo: string;
  leaveDateFrom: string;
  leaveDateTo: string;
  visitCountFrom: string;
  visitCountTo: string;
  visitPeriodFrom: string;
  visitPeriodTo: string;
  gender: string[];
  membershipStatus: string[];
  contractTypes: string[];   // 会員区分名
  contractForms: string[];   // 契約形態名 (会員区分に紐づく)
  hasUnpaidOnly: boolean;
};

export function newCondGroup(contractTypes: string[]): CondGroup {
  return {
    joinDateFrom: "", joinDateTo: "",
    leaveDateFrom: "", leaveDateTo: "",
    visitCountFrom: "", visitCountTo: "",
    visitPeriodFrom: "", visitPeriodTo: "",
    gender: ["male", "female"],
    membershipStatus: ["stable", "leaver"],
    contractTypes: [...contractTypes],
    contractForms: [],
    hasUnpaidOnly: false,
  };
}

export default function ConditionGroupForm({
  group,
  onChange,
  contractTypes,
  contractTypeOptions,
  contractTypesLoading = false,
  contractFormOptions,
  contractFormsLoading = false,
  cls,
}: {
  group: CondGroup;
  onChange: (patch: Partial<CondGroup>) => void;
  contractTypes: string[];
  // 店舗に属する契約種別(会員区分)。指定時は検索付きピッカーを表示する。
  contractTypeOptions?: ContractTypeOption[];
  contractTypesLoading?: boolean;
  // 会員区分に紐づく契約形態。指定時は検索付きピッカーを表示する。
  contractFormOptions?: ContractTypeOption[];
  contractFormsLoading?: boolean;
  cls: string; // "push" | "dm"
}) {
  const toggleArr = (key: "gender" | "membershipStatus" | "contractTypes" | "contractForms", value: string) => {
    const cur = group[key];
    onChange({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Partial<CondGroup>);
  };
  // セグメント型トグル (性別/在籍状況)
  const Seg = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button type="button" className={`kb-seg${active ? " on" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="kb-seg-check">{active ? "✓" : ""}</span>
      {label}
    </button>
  );

  return (
    <>
      <div className={`${cls}-field`}>
        <label>入会日範囲</label>
        <div className={`${cls}-row-2`}>
          <input type="date" value={group.joinDateFrom} onChange={(e) => onChange({ joinDateFrom: e.target.value })} />
          <span>~</span>
          <input type="date" value={group.joinDateTo} onChange={(e) => onChange({ joinDateTo: e.target.value })} />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>退会日範囲</label>
        <div className={`${cls}-row-2`}>
          <input type="date" value={group.leaveDateFrom} onChange={(e) => onChange({ leaveDateFrom: e.target.value })} />
          <span>~</span>
          <input type="date" value={group.leaveDateTo} onChange={(e) => onChange({ leaveDateTo: e.target.value })} />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>来館期間（回数を数える対象期間）</label>
        <div className={`${cls}-row-2`}>
          <input type="date" value={group.visitPeriodFrom} onChange={(e) => onChange({ visitPeriodFrom: e.target.value })} />
          <span>~</span>
          <input type="date" value={group.visitPeriodTo} onChange={(e) => onChange({ visitPeriodTo: e.target.value })} />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>来館回数</label>
        <div className={`${cls}-row-2`}>
          <input type="number" value={group.visitCountFrom} onChange={(e) => onChange({ visitCountFrom: e.target.value })} placeholder="Min" />
          <span>~</span>
          <input type="number" value={group.visitCountTo} onChange={(e) => onChange({ visitCountTo: e.target.value })} placeholder="Max" />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>性別</label>
        <div className="kb-seg-row">
          <Seg label="男性" active={group.gender.includes("male")} onClick={() => toggleArr("gender", "male")} />
          <Seg label="女性" active={group.gender.includes("female")} onClick={() => toggleArr("gender", "female")} />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>在籍状況</label>
        <div className="kb-seg-row">
          <Seg label="在籍中" active={group.membershipStatus.includes("stable")} onClick={() => toggleArr("membershipStatus", "stable")} />
          <Seg label="退会済" active={group.membershipStatus.includes("leaver")} onClick={() => toggleArr("membershipStatus", "leaver")} />
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>契約種別（会員区分）</label>
        {contractTypeOptions ? (
          <ContractTypePicker
            options={contractTypeOptions}
            selected={group.contractTypes}
            onChange={(names) => onChange({ contractTypes: names })}
            loading={contractTypesLoading}
          />
        ) : (
          <>
            <div className={`${cls}-label-row`}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>店舗を選択すると契約種別が表示されます</span>
              <div className={`${cls}-bulk-toggle`}>
                <button type="button" onClick={() => onChange({ contractTypes: [...contractTypes] })}>全選択</button>
                <span>/</span>
                <button type="button" onClick={() => onChange({ contractTypes: [] })}>解除</button>
              </div>
            </div>
            <div className={`${cls}-check-grid`}>
              {contractTypes.map((ct) => (
                <label key={ct}>
                  <input type="checkbox" checked={group.contractTypes.includes(ct)} onChange={() => toggleArr("contractTypes", ct)} />
                  {ct}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      {contractFormOptions && (
        <div className={`${cls}-field`}>
          <label>契約形態（会員区分に紐づく）</label>
          <ContractTypePicker
            options={contractFormOptions}
            selected={group.contractForms}
            onChange={(names) => onChange({ contractForms: names })}
            loading={contractFormsLoading}
            emptyHint="店舗を選択すると契約形態が表示されます"
          />
        </div>
      )}
      <div className={`${cls}-field`}>
        <label className={`kb-switch${group.hasUnpaidOnly ? " on" : ""}`}>
          <input type="checkbox" checked={group.hasUnpaidOnly} onChange={(e) => onChange({ hasUnpaidOnly: e.target.checked })} />
          <span className="kb-switch-track"><span className="kb-switch-thumb" /></span>
          <span className="kb-switch-text">未納者のみを抽出</span>
        </label>
      </div>
    </>
  );
}
