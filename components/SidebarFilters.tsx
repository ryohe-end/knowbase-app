"use client";

type Props = {
  brands: { brandId: string; name: string }[];
  depts: { deptId: string; name: string }[];
  recentTags: string[];

  selectedBrandId: string;
  selectedDeptId: string;

  setSelectedBrandId: (v: string) => void;
  setSelectedDeptId: (v: string) => void;
  setKeyword: (v: string) => void;
};

const ALL_BRAND_ID = "__ALL_BRAND__";
const ALL_DEPT_ID = "__ALL_DEPT__";

export default function SidebarFilters({
  brands,
  depts,
  recentTags,
  selectedBrandId,
  selectedDeptId,
  setSelectedBrandId,
  setSelectedDeptId,
  setKeyword,
}: Props) {
  return (
    <aside className="kb-panel" aria-label="フィルター">
      {/* ---- ブランドで探す ---- */}
      <div className="kb-panel-section">
        <div className="kb-panel-title">ブランドで探す</div>

        <div className="kb-chip-list vertical">
          {/* 全て */}
          <button
            type="button"
            className={
              "kb-chip" + (selectedBrandId === ALL_BRAND_ID ? " kb-chip-active" : "")
            }
            onClick={() => setSelectedBrandId(ALL_BRAND_ID)}
          >
            全て
          </button>

          {/* 各ブランド */}
          {brands.map((b) => (
            <button
              key={b.brandId}
              type="button"
              className={
                "kb-chip" +
                (selectedBrandId === b.brandId ? " kb-chip-active" : "")
              }
              onClick={() => setSelectedBrandId(b.brandId)}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 部署で探す ---- */}
      <div className="kb-panel-section">
        <div className="kb-panel-title">部署で探す</div>

        <div className="kb-chip-list vertical">
          {/* 全て */}
          <button
            type="button"
            className={
              "kb-chip" + (selectedDeptId === ALL_DEPT_ID ? " kb-chip-active" : "")
            }
            onClick={() => setSelectedDeptId(ALL_DEPT_ID)}
          >
            全て
          </button>

          {/* 各部署 */}
          {depts.map((d) => (
            <button
              key={d.deptId}
              type="button"
              className={
                "kb-chip" + (selectedDeptId === d.deptId ? " kb-chip-active" : "")
              }
              onClick={() => setSelectedDeptId(d.deptId)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 最近のタグ ---- */}
      <div className="kb-panel-section">
        <div className="kb-panel-title">最近のタグ</div>

        <div className="kb-chip-list">
          {recentTags.length > 0 ? (
            recentTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="kb-chip small"
                onClick={() => setKeyword(tag)}
              >
                #{tag}
              </button>
            ))
          ) : (
            <span className="kb-subnote">タグがまだ登録されていません。</span>
          )}
        </div>
      </div>
    </aside>
  );
}
