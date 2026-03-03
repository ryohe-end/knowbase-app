"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  ArrowLeft, Edit3, Trash2, Plus, 
  Settings, Layers, Mail, 
  ChevronRight, CheckCircle2, X, Check, Save, Calendar, 
  ChevronDown, ChevronUp, Search, Copy, RefreshCw, CreditCard
} from "lucide-react";

export default function OpenEntryManagementPage() {
  const router = useRouter();
  const shopName = "旭川アモール";
  const shopId = "000121";

  // --- 状態管理 ---
  // Modal State: typeに 'CAMPAIGN' を追加
  const [isModalOpen, setIsModalOpen] = useState<{ open: boolean, type: 'MEMBER' | 'OPTION' | 'CAMPAIGN' | null }>({ open: false, type: null });
  const [searchQuery, setSearchQuery] = useState("");

  // ② キャンペーン設定データ
  const [campaigns, setCampaigns] = useState([
    { 
      id: 209, name: "2月通常入会", status: "公開中",
      dispStart: "2026-02-01", dispEnd: "2026-02-28",
      appStart: "2026-02-01", appEnd: "2026-02-28",
      cardFee: true, priceType: 'RELATIVE', priceFirst: 0, priceSecond: 2980, monthlyPrices: []
    },
    { 
      id: 184, name: "3月春の入会キャンペーン", status: "公開中",
      dispStart: "2025-03-01", dispEnd: "2025-03-31",
      appStart: "2025-03-01", appEnd: "2025-03-31",
      cardFee: false, priceType: 'MONTHLY', priceFirst: 0, priceSecond: 0, 
      monthlyPrices: [{ month: "2025-03", price: 0 }, { month: "2025-04", price: 1500 }]
    },
  ]);

  // ③ 会員種別データ
  const [memberTypes, setMemberTypes] = useState([
    { id: "4886", name: "プレミアム", visible: true, price: 3980, desc: "全店舗利用可能なお得なプランです。", expand: false },
    { id: "4906", name: "スタンダード", visible: true, price: 2980, desc: "標準的なプランです。", expand: false },
    { id: "2230", name: "1980円会員", visible: false, price: 1980, desc: "月額1980円の限定プラン。", expand: false },
    { id: "8502", name: "法人個人A", visible: true, price: 2980, desc: "法人契約の個人会員様向け。", expand: false },
    { id: "4902", name: "クレジット会員2", visible: false, price: 3500, desc: "クレジットカード決済限定。", expand: false },
  ]);

  // ④ オプション詳細データ
  const [options, setOptions] = useState([
    { 
      id: "9636", name: "FIT365あんしんサポート", visible: true, price: 550, desc: "怪我や盗難時のお見舞金サービスです。",
      targetMembers: ["4886", "4906"], freeMonths: 2, isAutoAttach: true, expand: false
    },
    { 
      id: "9591", name: "レディースエリア", visible: true, price: 550, desc: "女性専用のセキュリティエリアです。",
      targetMembers: ["4886", "4906", "8502"], freeMonths: 0, isAutoAttach: false, expand: false
    },
    { 
      id: "9001", name: "契約ロッカー", visible: false, price: 1100, desc: "自分専用のプライベートロッカー。",
      targetMembers: [], freeMonths: 0, isAutoAttach: false, expand: false
    },
  ]);

  // --- 編集用の一時ステート ---
  const [tempSelection, setTempSelection] = useState<any[]>([]);
  // キャンペーン編集用単体ステート
  const [editingCampaign, setEditingCampaign] = useState<any>({
    id: null, name: "", status: "下書き",
    dispStart: "", dispEnd: "", appStart: "", appEnd: "",
    cardFee: true, priceType: "RELATIVE", // RELATIVE or MONTHLY
    priceFirst: 0, priceSecond: 0,
    monthlyPrices: [{ month: "", price: 0 }]
  });

  // --- ハンドラ ---

  // キャンペーンモーダルを開く
  const openCampaignModal = (campaign: any | null) => {
    if (campaign) {
      setEditingCampaign({ ...campaign });
    } else {
      // 新規作成時のデフォルト
      setEditingCampaign({
        id: null, name: "", status: "下書き",
        dispStart: "", dispEnd: "", appStart: "", appEnd: "",
        cardFee: true, priceType: "RELATIVE",
        priceFirst: 0, priceSecond: 0,
        monthlyPrices: [{ month: "", price: 0 }]
      });
    }
    setIsModalOpen({ open: true, type: 'CAMPAIGN' });
  };

  // キャンペーン保存
  const handleSaveCampaign = () => {
    if (editingCampaign.id) {
      // 更新
      setCampaigns(campaigns.map(c => c.id === editingCampaign.id ? editingCampaign : c));
    } else {
      // 新規作成
      const newId = Math.floor(Math.random() * 10000);
      setCampaigns([{ ...editingCampaign, id: newId, status: "公開中" }, ...campaigns]);
    }
    setIsModalOpen({ open: false, type: null });
  };

  // その他の設定を開く
  const openSettings = (type: 'MEMBER' | 'OPTION') => {
    const data = type === 'MEMBER' ? memberTypes : options;
    setTempSelection(JSON.parse(JSON.stringify(data)));
    setIsModalOpen({ open: true, type });
  };

  const handleSaveSettings = () => {
    if (isModalOpen.type === 'MEMBER') setMemberTypes(tempSelection);
    if (isModalOpen.type === 'OPTION') setOptions(tempSelection);
    setIsModalOpen({ open: false, type: null });
  };

  const duplicateCampaign = (id: number) => {
    const target = campaigns.find(c => c.id === id);
    if (target) {
      const newCampaign = {
        ...target,
        id: Math.floor(Math.random() * 10000),
        name: `${target.name} (コピー)`,
        status: "下書き"
      };
      setCampaigns([newCampaign, ...campaigns]);
    }
  };

  const filteredCampaigns = campaigns
    .filter(c => c.name.includes(searchQuery) || c.status.includes(searchQuery))
    .sort((a, b) => (b.id || 0) - (a.id || 0));

  const toggleDesc = (index: number) => {
    const next = [...tempSelection];
    next[index].expand = !next[index].expand;
    setTempSelection(next);
  };

  return (
    <div className="oem-root">
      <header className="oem-header">
        <div className="oem-header-inner">
          <div className="oem-brand">
            <Link href="/store-settings/admin-portal" className="oem-back-link"><ArrowLeft size={20} /></Link>
            <h1 className="oem-main-title">オープン後入会設定</h1>
          </div>
          <div className="oem-header-info">{shopId} {shopName}</div>
        </div>
      </header>

      <main className="oem-container">
        
        {/* ① クイック編集メニュー */}
        <section className="oem-quick-nav">
          <div className="oem-nav-card" onClick={() => router.push('/store-settings/admin-portal/open-entry/mail-text')}>
            <div className="oem-nav-icon green"><Mail size={22} /></div>
            <div className="oem-nav-text">
              <span className="oem-nav-label">MAIL</span>
              <span className="oem-nav-title">完了メール文面編集</span>
            </div>
            <ChevronRight size={18} className="oem-nav-arrow" />
          </div>
          <div className="oem-nav-card">
            <div className="oem-nav-icon yellow"><Settings size={22} /></div>
            <div className="oem-nav-text">
              <span className="oem-nav-label">SYSTEM</span>
              <span className="oem-nav-title">その他システム設定</span>
            </div>
            <ChevronRight size={18} className="oem-nav-arrow" />
          </div>
        </section>

        <div className="oem-grid">
          
          {/* 左カラム：会員種別・オプション制御 */}
          <aside className="oem-side-col">
            <div className="oem-section-header">
              <h2>表示・提供制御設定</h2>
            </div>
            
            {/* 会員種別 */}
            <div className="oem-control-card">
              <div className="oem-card-head">
                <div className="oem-head-text">
                  <h3>会員種別・金額</h3>
                  <p>表示する種別とデフォルト金額</p>
                </div>
                <button onClick={() => openSettings('MEMBER')} className="oem-edit-link">編集する</button>
              </div>
              <div className="oem-list-group">
                {memberTypes.filter(t => t.visible).map(t => (
                  <div key={t.id} className="oem-list-row">
                    <div className="oem-row-left">
                      <span className="oem-row-name">{t.name}</span>
                    </div>
                    <div className="oem-row-right">
                      <span className="oem-row-price">¥{t.price.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {memberTypes.filter(t => !t.visible).length > 0 && (
                   <div className="oem-list-msg">他 {memberTypes.filter(t => !t.visible).length} 件 非表示</div>
                )}
              </div>
            </div>

            {/* オプション詳細 */}
            <div className="oem-control-card">
              <div className="oem-card-head">
                <div className="oem-head-text">
                  <h3>オプション提供</h3>
                  <p>紐付け・金額・無料期間の設定</p>
                </div>
                <button onClick={() => openSettings('OPTION')} className="oem-edit-link">詳細設定</button>
              </div>
              <div className="oem-list-group">
                {options.filter(o => o.visible).map(o => (
                  <div key={o.id} className="oem-list-row">
                    <div className="oem-row-left">
                      <div className="flex-row-center">
                        <span className="oem-row-name">{o.name}</span>
                        {o.isAutoAttach && <span className="oem-badge-fill">必須</span>}
                      </div>
                    </div>
                    <div className="oem-row-right column">
                       <span className="oem-row-price">¥{o.price.toLocaleString()}</span>
                       <span className="oem-row-meta">無料: {o.freeMonths}ヶ月</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* 右カラム：キャンペーン設定 */}
          <section className="oem-main-col">
            <div className="oem-section-header">
              <h2>キャンペーン管理</h2>
              <button className="oem-add-btn" onClick={() => openCampaignModal(null)}>
                <Plus size={16} /> 新規作成
              </button>
            </div>
            
            <div className="oem-search-bar">
              <Search size={16} className="search-icon" />
              <input 
                type="text" 
                placeholder="過去のキャンペーンを検索..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="oem-white-card">
              {filteredCampaigns.length > 0 ? (
                filteredCampaigns.map(cp => (
                  <div key={cp.id} className={`oem-campaign-item ${cp.status === '終了' ? 'expired' : ''}`}>
                    <div className="oem-cp-info">
                      <div className={`oem-cp-status ${cp.status === '下書き' ? 'draft' : cp.status === '終了' ? 'ended' : ''}`}>
                        <CheckCircle2 size={12} /> {cp.status}
                      </div>
                      <h3 className="oem-cp-name">{cp.name}</h3>
                      <p className="oem-cp-date"><Calendar size={14}/> {cp.dispStart} 〜 {cp.dispEnd}</p>
                    </div>
                    <div className="oem-cp-actions">
                      <button className="oem-icon-btn" title="編集" onClick={() => openCampaignModal(cp)}>
                        <Edit3 size={16} />
                      </button>
                      <button className="oem-icon-btn" title="複製" onClick={() => duplicateCampaign(cp.id)}>
                        <Copy size={16} />
                      </button>
                      <button className="oem-icon-btn red" title="削除">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="oem-empty-state">該当するキャンペーンはありません</div>
              )}
            </div>
          </section>

        </div>
      </main>

      {/* --- 統合設定モーダル --- */}
      {isModalOpen.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>
                {isModalOpen.type === 'MEMBER' && '会員種別と金額の設定'}
                {isModalOpen.type === 'OPTION' && 'オプション詳細設定'}
                {isModalOpen.type === 'CAMPAIGN' && (editingCampaign.id ? 'キャンペーン編集' : '新規キャンペーン作成')}
              </h2>
              <button className="modal-close" onClick={() => setIsModalOpen({ open: false, type: null })}><X size={20} /></button>
            </div>
            
            <div className="modal-body">
              {/* === キャンペーン作成/編集モード === */}
              {isModalOpen.type === 'CAMPAIGN' && (
                <div className="campaign-form">
                  <div className="form-group">
                    <label>キャンペーン名</label>
                    <input 
                      type="text" 
                      className="oem-input"
                      value={editingCampaign.name}
                      onChange={(e) => setEditingCampaign({...editingCampaign, name: e.target.value})}
                      placeholder="例：3月春の入会キャンペーン"
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>表示期間</label>
                      <div className="date-range">
                        <input type="date" className="oem-input" value={editingCampaign.dispStart} onChange={(e) => setEditingCampaign({...editingCampaign, dispStart: e.target.value})} />
                        <span>〜</span>
                        <input type="date" className="oem-input" value={editingCampaign.dispEnd} onChange={(e) => setEditingCampaign({...editingCampaign, dispEnd: e.target.value})} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>利用開始選択範囲</label>
                      <div className="date-range">
                        <input type="date" className="oem-input" value={editingCampaign.appStart} onChange={(e) => setEditingCampaign({...editingCampaign, appStart: e.target.value})} />
                        <span>〜</span>
                        <input type="date" className="oem-input" value={editingCampaign.appEnd} onChange={(e) => setEditingCampaign({...editingCampaign, appEnd: e.target.value})} />
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                     <label className="toggle-label">
                        <span>カード発行料の有無</span>
                        <div className={`toggle-switch ${editingCampaign.cardFee ? 'on' : 'off'}`} onClick={() => setEditingCampaign({...editingCampaign, cardFee: !editingCampaign.cardFee})}>
                          <div className="toggle-handle"></div>
                        </div>
                        <span className="toggle-status">{editingCampaign.cardFee ? "有り(有料)" : "無し(無料)"}</span>
                     </label>
                  </div>

                  <div className="form-section bordered">
                    <label className="section-label">金額指定方法</label>
                    <div className="radio-group">
                       <label className={`radio-card ${editingCampaign.priceType === 'RELATIVE' ? 'active' : ''}`}>
                          <input type="radio" name="priceType" checked={editingCampaign.priceType === 'RELATIVE'} onChange={() => setEditingCampaign({...editingCampaign, priceType: 'RELATIVE'})} />
                          <div className="radio-content">
                            <span className="radio-title">初月・次月金額指定(税別)</span>
                            <span className="radio-desc">入会月と翌月の金額を固定で設定します</span>
                          </div>
                       </label>
                       <label className={`radio-card ${editingCampaign.priceType === 'MONTHLY' ? 'active' : ''}`}>
                          <input type="radio" name="priceType" checked={editingCampaign.priceType === 'MONTHLY'} onChange={() => setEditingCampaign({...editingCampaign, priceType: 'MONTHLY'})} />
                          <div className="radio-content">
                            <span className="radio-title">月毎金額指定(税別)</span>
                            <span className="radio-desc">カレンダーの特定の月に対して金額を設定します</span>
                          </div>
                       </label>
                    </div>

                    {/* 金額入力エリア (条件分岐) */}
                    <div className="price-input-area">
                      {editingCampaign.priceType === 'RELATIVE' ? (
                         <div className="form-row">
                           <div className="form-group">
                             <label>初月 (1ヶ月目)</label>
                             <div className="price-input-wrapper">
                               <input type="number" className="oem-input text-right" value={editingCampaign.priceFirst} onChange={(e) => setEditingCampaign({...editingCampaign, priceFirst: e.target.value})} />
                               <span>円</span>
                             </div>
                           </div>
                           <div className="form-group">
                             <label>次月 (2ヶ月目)</label>
                             <div className="price-input-wrapper">
                               <input type="number" className="oem-input text-right" value={editingCampaign.priceSecond} onChange={(e) => setEditingCampaign({...editingCampaign, priceSecond: e.target.value})} />
                               <span>円</span>
                             </div>
                           </div>
                         </div>
                      ) : (
                         <div className="monthly-list">
                            <label>対象月と金額を追加してください</label>
                            {editingCampaign.monthlyPrices.map((mp:any, idx:number) => (
                              <div key={idx} className="monthly-row">
                                <input type="month" className="oem-input" value={mp.month} onChange={(e) => {
                                  const newArr = [...editingCampaign.monthlyPrices];
                                  newArr[idx].month = e.target.value;
                                  setEditingCampaign({...editingCampaign, monthlyPrices: newArr});
                                }} />
                                <div className="price-input-wrapper">
                                   <input type="number" className="oem-input text-right" value={mp.price} onChange={(e) => {
                                      const newArr = [...editingCampaign.monthlyPrices];
                                      newArr[idx].price = e.target.value;
                                      setEditingCampaign({...editingCampaign, monthlyPrices: newArr});
                                   }} />
                                   <span>円</span>
                                </div>
                                <button className="remove-btn" onClick={() => {
                                   const newArr = editingCampaign.monthlyPrices.filter((_:any, i:number) => i !== idx);
                                   setEditingCampaign({...editingCampaign, monthlyPrices: newArr});
                                }}><Trash2 size={16} /></button>
                              </div>
                            ))}
                            <button className="add-month-btn" onClick={() => {
                               setEditingCampaign({...editingCampaign, monthlyPrices: [...editingCampaign.monthlyPrices, {month: "", price: 0}]});
                            }}>
                              <Plus size={14} /> 月を追加
                            </button>
                         </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* === 会員種別モード (既存) === */}
              {isModalOpen.type === 'MEMBER' && (
                <div className="selection-list">
                  <p className="modal-desc">利用する会員種別にチェックを入れ、デフォルト金額を設定してください。</p>
                  {tempSelection.map((t, i) => (
                    <div key={t.id} className={`member-edit-card ${t.visible ? 'active' : ''}`}>
                      <div className="member-card-top">
                        <label className="member-check-group">
                          <input 
                            type="checkbox" 
                            checked={t.visible} 
                            onChange={() => {
                              const next = [...tempSelection];
                              next[i].visible = !next[i].visible;
                              setTempSelection(next);
                            }} 
                          />
                          <div className="custom-checkbox">{t.visible && <Check size={14} />}</div>
                          <span className="member-name">{t.name}</span>
                        </label>
                        <div className="member-price-input">
                          <label>金額</label>
                          <input 
                            type="number" 
                            disabled={!t.visible}
                            value={t.price} 
                            onChange={(e) => {
                              const next = [...tempSelection];
                              next[i].price = parseInt(e.target.value) || 0;
                              setTempSelection(next);
                            }}
                          />
                          <span>円</span>
                        </div>
                      </div>
                      {t.visible && (
                        <div className="member-desc-section">
                          <button className="desc-toggle-btn" onClick={() => toggleDesc(i)}>
                            {t.expand ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            説明文を編集
                          </button>
                          {t.expand && (
                            <textarea 
                              className="desc-textarea"
                              rows={3}
                              value={t.desc}
                              onChange={(e) => {
                                const next = [...tempSelection];
                                next[i].desc = e.target.value;
                                setTempSelection(next);
                              }}
                              placeholder="説明文を入力（HTML可）"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* === オプション詳細モード (既存) === */}
              {isModalOpen.type === 'OPTION' && (
                <div className="option-detail-list">
                  <p className="modal-desc">オプションの金額、無料期間、対象会員を設定してください。</p>
                  {tempSelection.map((o, i) => (
                    <div key={o.id} className={`opt-detail-card ${o.visible ? 'active' : ''}`}>
                      <div className="opt-detail-head">
                        <label className="opt-check">
                          <input type="checkbox" checked={o.visible} onChange={() => {
                            const next = [...tempSelection];
                            next[i].visible = !next[i].visible;
                            setTempSelection(next);
                          }} />
                          <div className="custom-checkbox">{o.visible && <Check size={14} />}</div>
                          <span className="opt-name-large">{o.name}</span>
                        </label>
                        {o.visible && (
                          <div className="member-price-input compact">
                            <input 
                              type="number" 
                              value={o.price} 
                              onChange={(e) => {
                                const next = [...tempSelection];
                                next[i].price = parseInt(e.target.value) || 0;
                                setTempSelection(next);
                              }}
                            />
                            <span>円</span>
                          </div>
                        )}
                      </div>
                      {o.visible && (
                        <div className="opt-detail-body">
                          <div className="opt-form-row">
                            <div className="opt-field">
                              <label>無料期間（ヶ月）</label>
                              <input type="number" value={o.freeMonths} onChange={(e) => {
                                const next = [...tempSelection];
                                next[i].freeMonths = parseInt(e.target.value) || 0;
                                setTempSelection(next);
                              }} className="oem-input" />
                            </div>
                            <div className="opt-field checkbox">
                              <label>
                                <input type="checkbox" checked={o.isAutoAttach} onChange={(e) => {
                                  const next = [...tempSelection];
                                  next[i].isAutoAttach = e.target.checked;
                                  setTempSelection(next);
                                }} />
                                <span>必須付帯（べたづけ）にする</span>
                              </label>
                            </div>
                          </div>
                          <div className="opt-field full">
                            <label>対象の会員種別を選択</label>
                            <div className="opt-member-selector">
                              {memberTypes.filter(m => m.visible).map(m => {
                                const isSelected = o.targetMembers.includes(m.id);
                                return (
                                  <button key={m.id} className={isSelected ? 'active' : ''} onClick={() => {
                                    const next = [...tempSelection];
                                    const currentTargets = [...next[i].targetMembers];
                                    if (currentTargets.includes(m.id)) {
                                      next[i].targetMembers = currentTargets.filter((id: string) => id !== m.id);
                                    } else {
                                      next[i].targetMembers = [...currentTargets, m.id];
                                    }
                                    setTempSelection(next);
                                  }}>
                                    {m.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="member-desc-section">
                            <button className="desc-toggle-btn" onClick={() => toggleDesc(i)}>
                              {o.expand ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              オプション説明文を編集
                            </button>
                            {o.expand && (
                              <textarea 
                                className="desc-textarea"
                                rows={3}
                                value={o.desc}
                                onChange={(e) => {
                                  const next = [...tempSelection];
                                  next[i].desc = e.target.value;
                                  setTempSelection(next);
                                }}
                                placeholder="オプションの説明文を入力"
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setIsModalOpen({ open: false, type: null })}>キャンセル</button>
              <button className="btn-save" onClick={isModalOpen.type === 'CAMPAIGN' ? handleSaveCampaign : handleSaveSettings}>
                <Save size={18} /> 設定を保存して反映
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .oem-root { background: #f4f7f9; min-height: 100vh; font-family: 'Inter', sans-serif; color: #1e293b; }
        .oem-header { background: #fff; border-bottom: 2px solid #fbbf24; height: 64px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .oem-header-inner { max-width: 1240px; margin: 0 auto; height: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
        .oem-brand { display: flex; align-items: center; gap: 16px; }
        .oem-back-link { color: #94a3b8; display: flex; }
        .oem-main-title { font-size: 18px; font-weight: 800; color: #1e293b; }
        .oem-header-info { font-size: 13px; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 6px 12px; border-radius: 8px; }

        .oem-container { max-width: 1240px; margin: 0 auto; padding: 32px 24px; }
        
        .oem-quick-nav { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 32px; max-width: 600px; }
        .oem-nav-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px 20px; display: flex; align-items: center; gap: 16px; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.01); }
        .oem-nav-card:hover { transform: translateY(-2px); border-color: #fbbf24; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }
        .oem-nav-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
        .oem-nav-icon.yellow { background: #fffbeb; color: #d97706; }
        .oem-nav-icon.blue { background: #eff6ff; color: #3b82f6; }
        .oem-nav-icon.green { background: #f0fdf4; color: #10b981; }
        .oem-nav-label { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .oem-nav-title { display: block; font-size: 14px; font-weight: 700; color: #1e293b; }
        .oem-nav-arrow { margin-left: auto; color: #cbd5e1; }

        .oem-grid { display: grid; grid-template-columns: 420px 1fr; gap: 32px; }
        .oem-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .oem-section-header h2 { font-size: 14px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
        
        .oem-add-btn { background: #1e293b; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: 0.2s; }
        
        .oem-search-bar { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0 16px; display: flex; align-items: center; gap: 12px; margin-bottom: 16px; height: 44px; }
        .oem-search-bar .search-icon { color: #94a3b8; }
        .oem-search-bar input { border: none; background: transparent; height: 100%; width: 100%; outline: none; font-size: 13px; font-weight: 600; color: #1e293b; }

        .oem-white-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
        .oem-empty-state { padding: 40px; text-align: center; font-size: 13px; color: #94a3b8; }
        
        .oem-campaign-item { padding: 20px 24px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; transition: 0.2s; }
        .oem-campaign-item:last-child { border-bottom: none; }
        .oem-campaign-item:hover { background: #f8fafc; }
        .oem-campaign-item.expired { opacity: 0.6; background: #fafafa; }
        
        .oem-cp-status { font-size: 11px; font-weight: 800; color: #10b981; display: flex; align-items: center; gap: 4px; margin-bottom: 4px; background: #ecfdf5; width: fit-content; padding: 2px 8px; border-radius: 12px; }
        .oem-cp-status.draft { background: #f3f4f6; color: #64748b; }
        .oem-cp-status.ended { background: #fef2f2; color: #ef4444; }
        
        .oem-cp-name { font-size: 16px; font-weight: 800; color: #1e293b; margin: 0 0 4px 0; }
        .oem-cp-date { font-size: 13px; color: #64748b; display: flex; align-items: center; gap: 6px; margin: 0; }
        .oem-cp-actions { display: flex; gap: 8px; }
        .oem-icon-btn { padding: 8px 12px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 6px; justify-content: center; cursor: pointer; transition: 0.2s; }
        .oem-icon-btn:hover { border-color: #fbbf24; color: #d97706; }
        .oem-icon-btn.red:hover { background: #fef2f2; border-color: #ef4444; color: #ef4444; }

        /* Side Controls */
        .oem-control-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 20px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02); }
        .oem-card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
        .oem-head-text h3 { font-size: 15px; font-weight: 800; color: #1e293b; margin: 0 0 2px 0; }
        .oem-head-text p { font-size: 11px; color: #94a3b8; margin: 0; }
        .oem-edit-link { font-size: 12px; font-weight: 700; color: #4f46e5; border: none; background: #eef2ff; padding: 6px 12px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
        .oem-edit-link:hover { background: #e0e7ff; }

        .oem-list-group { display: flex; flex-direction: column; gap: 0; }
        .oem-list-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px dashed #f1f5f9; }
        .oem-list-row:last-child { border-bottom: none; }
        .oem-list-msg { color: #94a3b8; font-size: 11px; margin-top: 8px; }
        
        .oem-row-name { font-size: 13px; font-weight: 700; color: #475569; }
        .oem-row-price { font-size: 13px; font-weight: 800; color: #1e293b; text-align: right; }
        .oem-row-meta { font-size: 10px; color: #94a3b8; display: block; text-align: right; }
        .oem-row-right.column { display: flex; flex-direction: column; align-items: flex-end; }
        .flex-row-center { display: flex; align-items: center; gap: 8px; }
        .oem-badge-fill { background: #4f46e5; color: #fff; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 4px; }

        /* Modal Layout */
        .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal-content { background: #fff; width: 100%; max-width: 680px; border-radius: 32px; display: flex; flex-direction: column; max-height: 90vh; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .modal-header { padding: 24px 32px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .modal-header h2 { font-size: 18px; font-weight: 800; margin: 0; }
        .modal-close { background: #f1f5f9; border: none; width: 36px; height: 36px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; }
        .modal-body { padding: 32px; overflow-y: auto; flex: 1; background: #f8fafc; }
        .modal-desc { font-size: 13px; color: #64748b; margin-bottom: 20px; font-weight: 600; }

        /* Campaign Form Styles */
        .campaign-form { display: flex; flex-direction: column; gap: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 8px; flex: 1; }
        .form-group label { font-size: 12px; font-weight: 700; color: #64748b; }
        .form-row { display: flex; gap: 16px; }
        .date-range { display: flex; align-items: center; gap: 8px; }
        .date-range span { font-weight: 700; color: #94a3b8; }
        
        .form-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; }
        .form-section.bordered { border: 1px solid #e2e8f0; }
        
        .toggle-label { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .toggle-label span { font-size: 13px; font-weight: 700; color: #334155; }
        .toggle-switch { width: 44px; height: 24px; background: #cbd5e1; border-radius: 20px; padding: 2px; transition: 0.2s; position: relative; }
        .toggle-switch.on { background: #10b981; }
        .toggle-handle { width: 20px; height: 20px; background: #fff; border-radius: 50%; transition: 0.2s; }
        .toggle-switch.on .toggle-handle { transform: translateX(20px); }
        .toggle-status { font-size: 12px; font-weight: 800; color: #1e293b; margin-left: 10px; min-width: 80px; text-align: right; }

        .radio-group { display: flex; gap: 12px; margin-top: 10px; margin-bottom: 16px; }
        .radio-card { flex: 1; background: #f8fafc; border: 2px solid #e2e8f0; padding: 12px; border-radius: 12px; cursor: pointer; display: flex; align-items: flex-start; gap: 10px; transition: 0.2s; }
        .radio-card.active { border-color: #3b82f6; background: #eff6ff; }
        .radio-card input { margin-top: 4px; }
        .radio-content { display: flex; flex-direction: column; }
        .radio-title { font-size: 13px; font-weight: 800; color: #1e293b; }
        .radio-desc { font-size: 10px; color: #64748b; font-weight: 500; margin-top: 2px; }

        .price-input-wrapper { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 10px; height: 40px; }
        .price-input-wrapper input { border: none; outline: none; background: transparent; height: 100%; width: 100%; font-weight: 700; color: #1e293b; }
        .price-input-wrapper span { font-size: 12px; font-weight: 700; color: #94a3b8; }
        
        .monthly-list { display: flex; flex-direction: column; gap: 8px; background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px dashed #cbd5e1; }
        .monthly-row { display: grid; grid-template-columns: 1fr 1fr 40px; gap: 8px; align-items: center; }
        .add-month-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: 1px dashed #94a3b8; border-radius: 8px; color: #64748b; font-size: 12px; font-weight: 700; background: #fff; cursor: pointer; margin-top: 8px; }
        .remove-btn { background: #fee2e2; border: none; color: #ef4444; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; }

        /* Member Edit Card */
        .selection-list { display: flex; flex-direction: column; gap: 12px; }
        .member-edit-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; transition: 0.2s; }
        .member-edit-card.active { border-color: #4f46e5; box-shadow: 0 4px 12px -2px rgba(79, 70, 229, 0.1); }
        
        .member-card-top { display: flex; justify-content: space-between; align-items: center; }
        .member-check-group { display: flex; align-items: center; gap: 12px; cursor: pointer; }
        .member-check-group input { display: none; }
        .custom-checkbox { width: 22px; height: 22px; border: 2px solid #cbd5e1; border-radius: 6px; background: #fff; display: flex; align-items: center; justify-content: center; color: #4f46e5; }
        .member-edit-card.active .custom-checkbox { background: #4f46e5; color: #fff; border-color: #4f46e5; }
        .member-name { font-size: 14px; font-weight: 800; color: #1e293b; }

        .member-price-input { display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 4px 8px; border-radius: 8px; border: 1px solid #e2e8f0; }
        .member-price-input.compact { padding: 2px 6px; height: 32px; }
        .member-price-input label { font-size: 10px; font-weight: 800; color: #94a3b8; }
        .member-price-input input { width: 70px; border: none; background: transparent; text-align: right; font-weight: 800; color: #1e293b; outline: none; }
        .member-price-input span { font-size: 11px; font-weight: 700; color: #64748b; }

        .member-desc-section { margin-top: 12px; border-top: 1px dashed #e2e8f0; padding-top: 8px; }
        .desc-toggle-btn { font-size: 11px; font-weight: 700; color: #64748b; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; }
        .desc-textarea { width: 100%; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font-size: 12px; }

        /* Option Detail Card */
        .option-detail-list { display: flex; flex-direction: column; gap: 16px; }
        .opt-detail-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; transition: 0.2s; }
        .opt-detail-card.active { border-color: #4f46e5; box-shadow: 0 4px 12px -2px rgba(79, 70, 229, 0.1); }
        .opt-detail-head { display: flex; justify-content: space-between; align-items: center; }
        .opt-check { display: flex; align-items: center; gap: 12px; cursor: pointer; }
        .opt-check input { display: none; }
        .opt-name-large { font-size: 14px; font-weight: 800; color: #1e293b; }
        
        .opt-detail-body { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #e2e8f0; }
        .opt-form-row { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; margin-bottom: 16px; }
        .opt-field label { display: block; font-size: 10px; font-weight: 800; color: #64748b; margin-bottom: 6px; text-transform: uppercase; }
        .oem-input { width: 100%; height: 40px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0 10px; font-size: 13px; font-weight: 700; outline: none; background: #fff; }
        .opt-field.checkbox { display: flex; align-items: flex-end; padding-bottom: 8px; }
        .opt-field.checkbox label { font-size: 12px; font-weight: 700; color: #334155; text-transform: none; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .opt-field.checkbox input { width: 16px; height: 16px; accent-color: #4f46e5; }

        .opt-member-selector { display: flex; flex-wrap: wrap; gap: 6px; }
        .opt-member-selector button { padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 11px; font-weight: 700; color: #64748b; cursor: pointer; transition: 0.2s; }
        .opt-member-selector button:hover { border-color: #cbd5e1; }
        .opt-member-selector button.active { background: #1e293b; color: #fff; border-color: #1e293b; }

        .modal-footer { padding: 24px 32px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 12px; background: #fff; border-bottom-left-radius: 32px; border-bottom-right-radius: 32px; }
        .btn-cancel { padding: 14px 20px; border-radius: 14px; border: 1px solid #e2e8f0; background: #fff; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
        .btn-save { padding: 14px 24px; border-radius: 14px; border: none; background: #1e293b; color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s; }
        .btn-save:hover { background: #334155; transform: translateY(-1px); }

        @media (max-width: 1024px) {
          .oem-grid, .oem-quick-nav { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}