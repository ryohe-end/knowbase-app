// components/ConditionGroupForm.tsx
// Push/DM の会員抽出「条件グループ」1個分のフォーム。グループ内はすべて AND。
// push/dm でクラス接頭辞(cls)だけ差し替えて共用する。
"use client";

import React from "react";

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
  contractTypes: string[];
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
    hasUnpaidOnly: false,
  };
}

export default function ConditionGroupForm({
  group,
  onChange,
  contractTypes,
  cls,
}: {
  group: CondGroup;
  onChange: (patch: Partial<CondGroup>) => void;
  contractTypes: string[];
  cls: string; // "push" | "dm"
}) {
  const toggleArr = (key: "gender" | "membershipStatus" | "contractTypes", value: string) => {
    const cur = group[key];
    onChange({ [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Partial<CondGroup>);
  };

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
        <div className={`${cls}-check-row`}>
          <label><input type="checkbox" checked={group.gender.includes("male")} onChange={() => toggleArr("gender", "male")} /> 男性</label>
          <label><input type="checkbox" checked={group.gender.includes("female")} onChange={() => toggleArr("gender", "female")} /> 女性</label>
        </div>
      </div>
      <div className={`${cls}-field`}>
        <label>会員区分</label>
        <div className={`${cls}-check-row`}>
          <label><input type="checkbox" checked={group.membershipStatus.includes("stable")} onChange={() => toggleArr("membershipStatus", "stable")} /> 在籍中</label>
          <label><input type="checkbox" checked={group.membershipStatus.includes("leaver")} onChange={() => toggleArr("membershipStatus", "leaver")} /> 退会済</label>
        </div>
      </div>
      <div className={`${cls}-field`}>
        <div className={`${cls}-label-row`}>
          <label>契約種別</label>
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
      </div>
      <div className={`${cls}-field`}>
        <label className={`${cls}-unpaid-check`}>
          <input type="checkbox" checked={group.hasUnpaidOnly} onChange={(e) => onChange({ hasUnpaidOnly: e.target.checked })} /> 未納者のみを抽出
        </label>
      </div>
    </>
  );
}
