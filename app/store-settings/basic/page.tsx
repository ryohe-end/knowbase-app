"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import type { StoreAppConfig, MachineConfig, BusinessType, UnlockDeviceConfig, UnlockDeviceType } from "@/types/storeAppConfig";

// --- 定数定義 ---

const DEFAULT_CONFIG: StoreAppConfig = {
  clubCode: "",
  clubName: "",
  brand: "FIT365",
  businessType: "",
  isPointSupported: false,
  canUseDormantMember: false,
  showAppEnableButton: false,
  enableReferral: false,
  showMainContractChange: false,
  showKioskContractChange: false,
  showOptionChange: false,
  showFamilyAdd: false,
  showUnpaidPayment: false,
  showWithdrawal: false,
  unlockDevices: [],
  machines: [],
  inquiryEmails: [""], // 複数登録用に初期化
  createdAt: "",
  updatedAt: "",
};

const BUSINESS_TYPES: BusinessType[] = [
  "青", "赤SP LITE", "赤", "赤SP", "赤GH", "青GH", "緑", 
  "FIT365", "青LITE", "赤LITE", "メディカル", "JOYFIT+"
];

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

const TOGGLE_SETTINGS = [
  { key: "isPointSupported", label: "ポイント対応可能フラグ", desc: "ポイントシステムを有効化します" },
  { key: "canUseDormantMember", label: "休会会員利用可能フラグ", desc: "休会時に月に1度だけ施設を利用できるようにします" },
  { key: "showAppEnableButton", label: "アプリ有効化ボタン表示切り替え", desc: "APP入会を利用できます。" },
  { key: "enableReferral", label: "ベアレージポイント、友達紹介機能有効化切り替え", desc: "APP機能を有効化します" },
  { key: "showMainContractChange", label: "各種お手続き画面：主契約変更表示非表示切り替え", desc: "主契約変更表示をします。" },
  { key: "showKioskContractChange", label: "KIOSK：主契約変更表示切り替え", desc: "KIOSKで主契約変更表示をします" },
  { key: "showOptionChange", label: "オプション追加・解約表示切り替え", desc: "APPでオプション追加、解約できるようにします" },
  { key: "showFamilyAdd", label: "家族会員追加表示切り替え", desc: "APPで家族会員を追加できるようにします" },
  { key: "showUnpaidPayment", label: "未納金表示切り替え", desc: "APPで未納金のお支払い機能を有効化します" },
  { key: "showWithdrawal", label: "退会表示切り替え", desc: "APPで退会機能を有効化します" },
] as const;

// マシンマスタカテゴリ
const CATEGORY_ORDER = ["胸 (Chest)", "肩 (Shoulder)", "腕 (Arms)", "お腹 (Abs)", "背中 (Back)", "腰 (Lower Back)", "お尻 (Glutes)", "脚 (Legs)", "有酸素 (Cardio)", "ストレッチ (Stretch)", "フリーウェイト (Free Weight)"];
const MAKER_ORDER = ["MATRIX", "Life Fitness", "Technogym", "その他"];

const INITIAL_MAKER_PRESETS: Record<string, PresetCategory[]> = {
  MATRIX: [
    { category: "胸 (Chest)", items: [{ name: "Versa Chest Press", img: "https://placehold.co/300x200/222/fff?text=MATRIX+Chest+Press" }] },
    { category: "脚 (Legs)", items: [{ name: "Versa Leg Press", img: "https://placehold.co/300x200/222/fff?text=MATRIX+Leg+Press" }] },
  ],
  "Life Fitness": [
    { category: "胸 (Chest)", items: [{ name: "Insignia Chest Press", img: "https://placehold.co/300x200/b91c1c/fff?text=LF+Chest" }] },
  ],
  Technogym: [
    { category: "胸 (Chest)", items: [{ name: "Selection Chest Press", img: "https://placehold.co/300x200/fbbf24/333?text=TG+Chest" }] },
  ],
  "その他": [],
};

type PresetCategory = { category: string; items: { name: string; img: string }[] };

// --- コンポーネント ---

export default function BasicSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<StoreAppConfig>(DEFAULT_CONFIG);

  // マシンUI状態
  const [activeMaker, setActiveMaker] = useState<string>("MATRIX");
  const [activeCategory, setActiveCategory] = useState<string>("胸 (Chest)");
  const [customPresets, setCustomPresets] = useState(INITIAL_MAKER_PRESETS);
  
  // モーダル (マシン用)
  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customImage, setCustomImage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // モーダル (解錠機器用)
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [newDevice, setNewDevice] = useState<Partial<UnlockDeviceConfig>>({
    majorCode: "", minorCode: "", type: "入口", isEntrance: false, displayName: ""
  });

  const getSafeMachines = (val: any): MachineConfig[] => Array.isArray(val) ? val : [];
  const getSafeDevices = (val: any): UnlockDeviceConfig[] => Array.isArray(val) ? val : [];
  const getSafeEmails = (val: any): string[] => (Array.isArray(val) && val.length > 0) ? val : [""];

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/store-settings/basic");
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setForm({
              ...data.config,
              machines: getSafeMachines(data.config.machines),
              unlockDevices: getSafeDevices(data.config.unlockDevices),
              inquiryEmails: getSafeEmails(data.config.inquiryEmails),
            });
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm("設定を保存しますか？")) return;
    setSaving(true);

    // 空のメールアドレスを除去
    const cleanedEmails = (form.inquiryEmails || []).filter(email => email.trim() !== "");

    try {
      const res = await fetch("/api/store-settings/basic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          inquiryEmails: cleanedEmails
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      alert("保存しました。");
      const data = await res.json();
      if (data.config) {
        setForm({
            ...data.config,
            inquiryEmails: getSafeEmails(data.config.inquiryEmails)
        });
      }
    } catch (e) {
      alert("保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  // --- App問い合わせメール関連 (複数登録) ---
  const handleInquiryEmailChange = (index: number, value: string) => {
    const newEmails = [...(form.inquiryEmails || [""])];
    newEmails[index] = value;
    setForm({ ...form, inquiryEmails: newEmails });
  };

  const addInquiryEmail = () => {
    setForm({ ...form, inquiryEmails: [...(form.inquiryEmails || []), ""] });
  };

  const removeInquiryEmail = (index: number) => {
    const current = [...(form.inquiryEmails || [""])];
    if (current.length <= 1) {
      setForm({ ...form, inquiryEmails: [""] });
    } else {
      setForm({ ...form, inquiryEmails: current.filter((_, i) => i !== index) });
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("お使いのブラウザでは位置情報がサポートされていません。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(prev => ({
          ...prev,
          latitude: parseFloat(pos.coords.latitude.toFixed(6)),
          longitude: parseFloat(pos.coords.longitude.toFixed(6)),
        }));
        alert("現在地を取得しました。");
      },
      (err) => {
        alert("位置情報の取得に失敗しました。権限を確認してください。");
      }
    );
  };

  // --- マシン関連 ---
  const toggleMachine = (machineName: string, imgUrl: string) => {
    setForm((prev) => {
      const current = getSafeMachines(prev.machines);
      const exists = current.some((m) => m.name === machineName);
      if (exists) {
        return { ...prev, machines: current.filter((m) => m.name !== machineName) };
      } else {
        return { ...prev, machines: [...current, { name: machineName, imageUrl: imgUrl }] };
      }
    });
  };

  const removeMachine = (machineName: string) => {
    setForm((prev) => {
      const current = getSafeMachines(prev.machines);
      return { ...prev, machines: current.filter((m) => m.name !== machineName) };
    });
  };

  const handleRegisterMaster = () => {
    if (!customName.trim()) return;
    const newMachine = { 
      name: customName, 
      img: customImage || "https://placehold.co/300x200/e2e8f0/64748b?text=No+Photo" 
    };
    setCustomPresets((prev) => {
      const makerData = [...(prev[activeMaker] || [])];
      const catIndex = makerData.findIndex((c) => c.category === activeCategory);
      if (catIndex >= 0) {
        makerData[catIndex] = { ...makerData[catIndex], items: [...makerData[catIndex].items, newMachine] };
      } else {
        makerData.push({ category: activeCategory, items: [newMachine] });
      }
      return { ...prev, [activeMaker]: makerData };
    });
    toggleMachine(newMachine.name, newMachine.img);
    setIsMachineModalOpen(false);
    setCustomName("");
    setCustomImage("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCustomImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // --- 解錠機器関連 ---
  const openDeviceModal = () => {
    setNewDevice({ majorCode: "", minorCode: "", type: "入口", isEntrance: false, displayName: "" });
    setIsDeviceModalOpen(true);
  };

  const handleAddDevice = () => {
    if (!newDevice.majorCode || !newDevice.minorCode || !newDevice.displayName) {
      alert("必須項目を入力してください");
      return;
    }
    const device: UnlockDeviceConfig = {
      id: `dev_${Date.now()}`,
      majorCode: newDevice.majorCode,
      minorCode: newDevice.minorCode,
      type: newDevice.type as UnlockDeviceType,
      isEntrance: newDevice.isEntrance || false,
      displayName: newDevice.displayName,
    };
    
    setForm(prev => ({
      ...prev,
      unlockDevices: [...getSafeDevices(prev.unlockDevices), device],
    }));
    setIsDeviceModalOpen(false);
  };

  const removeDevice = (id: string) => {
    if (!confirm("この機器を削除しますか？")) return;
    setForm(prev => ({
      ...prev,
      unlockDevices: getSafeDevices(prev.unlockDevices).filter(d => d.id !== id),
    }));
  };

  const currentMachines = getSafeMachines(form.machines);
  const currentDevices = getSafeDevices(form.unlockDevices);
  
  const getCurrentCategoryItems = () => {
    const makerData = customPresets[activeMaker];
    const categoryData = makerData?.find((c) => c.category === activeCategory);
    return categoryData ? categoryData.items : [];
  };
  const availableCategories = CATEGORY_ORDER.filter(cat => 
    customPresets[activeMaker]?.some(group => group.category === cat)
  );

  return (
    <div className="kb-store-root">
      <AdminLoadingOverlay visible={loading || saving} text={saving ? "保存中..." : "読み込み中..."} />

      {/* Header */}
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/store-settings" className="kb-back-link">← メニューへ戻る</Link>
          <div style={{ fontWeight: 700 }}>アプリ基本設定</div>
          <button type="submit" form="settingsForm" className="kb-save-btn" disabled={loading || saving}>
            保存する
          </button>
        </div>
      </div>

      <main className="kb-main-container">
        <form id="settingsForm" onSubmit={handleSubmit} className="kb-form-grid">
          
          {/* 1. 店舗情報 */}
          <section className="kb-section">
            <h2 className="kb-section-title">店舗情報</h2>
            
            <div className="kb-form-row-group">
              <div className="kb-form-row">
                <label>ブランド <span className="req">*</span></label>
                <select name="brand" value={form.brand} onChange={handleChange} className="kb-input" required>
                  <option value="FIT365">FIT365</option>
                  <option value="JOYFIT">JOYFIT</option>
                </select>
              </div>
              <div className="kb-form-row">
                <label>業態</label>
                <select name="businessType" value={form.businessType} onChange={handleChange} className="kb-input">
                  <option value="">選択してください</option>
                  {BUSINESS_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                </select>
              </div>
            </div>

            <div className="kb-form-row-group">
              <div className="kb-form-row">
                <label>クラブコード</label>
                <input type="text" name="clubCode" value={form.clubCode} onChange={handleChange} className="kb-input" readOnly style={{ background: "#f1f5f9" }} />
              </div>
              <div className="kb-form-row">
                <label>クラブ名 <span className="req">*</span></label>
                <input type="text" name="clubName" value={form.clubName} onChange={handleChange} className="kb-input" required />
              </div>
            </div>

            <div className="kb-form-row">
              <label>店舗メールアドレス (マスター)</label>
              <input type="email" name="storeEmail" value={form.storeEmail || ""} onChange={handleChange} className="kb-input" placeholder="店舗代表アドレス" />
            </div>

            {/* ✅ App問い合わせ先 (複数登録対応) */}
            <div className="kb-form-row">
              <label>App上の問い合わせメール先設定</label>
              <div className="kb-email-list">
                {(form.inquiryEmails || [""]).map((email, index) => (
                  <div key={index} className="kb-email-row">
                    <input 
                      type="email" 
                      className="kb-input" 
                      value={email} 
                      onChange={(e) => handleInquiryEmailChange(index, e.target.value)}
                      placeholder={`通知先メールアドレス ${index + 1}`}
                    />
                    <button type="button" className="kb-email-remove" onClick={() => removeInquiryEmail(index)}>×</button>
                  </div>
                ))}
                <button type="button" className="kb-email-add-btn" onClick={addInquiryEmail}>＋ アドレスを追加</button>
              </div>
            </div>

            <div className="kb-divider" />

            <div className="kb-form-row">
              <label>所在地 (緯度・経度)</label>
              <div className="kb-geo-input-group">
                <input type="number" step="any" name="latitude" value={form.latitude || ""} onChange={handleChange} className="kb-input" placeholder="緯度" />
                <input type="number" step="any" name="longitude" value={form.longitude || ""} onChange={handleChange} className="kb-input" placeholder="経度" />
                <button type="button" onClick={handleGetCurrentLocation} className="kb-geo-btn">📍 現在地から取得</button>
              </div>
            </div>

            <div className="kb-form-row-group">
              <div className="kb-form-row">
                <label>都道府県</label>
                <select name="prefecture" value={form.prefecture || ""} onChange={handleChange} className="kb-input">
                  <option value="">選択</option>
                  {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="kb-form-row">
                <label>住所</label>
                <input type="text" name="address" value={form.address || ""} onChange={handleChange} className="kb-input" placeholder="市区町村・番地" />
              </div>
            </div>

            <div className="kb-form-row-group">
              <div className="kb-form-row">
                <label>外部リンク(店舗HP)</label>
                <input type="url" name="externalLink" value={form.externalLink || ""} onChange={handleChange} className="kb-input" />
              </div>
              <div className="kb-form-row">
                <label>パーソナルトレーニングURL</label>
                <input type="url" name="personalTrainingUrl" value={form.personalTrainingUrl || ""} onChange={handleChange} className="kb-input" />
              </div>
            </div>
          </section>

          {/* 2. 店舗設定 */}
          <section className="kb-section">
            <h2 className="kb-section-title">店舗設定</h2>
            <div className="kb-toggle-list">
              {TOGGLE_SETTINGS.map((setting) => (
                <div key={setting.key} className="kb-toggle-row">
                  <div className="kb-toggle-info">
                    <div className="kb-toggle-label">{setting.label}</div>
                    <div className="kb-toggle-desc">{setting.desc}</div>
                  </div>
                  <div className="kb-toggle-switch">
                    <input 
                      type="checkbox" 
                      id={setting.key} 
                      name={setting.key}
                      checked={(form as any)[setting.key] || false}
                      onChange={handleChange}
                    />
                    <label htmlFor={setting.key}></label>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 3. 解錠機器設定 */}
          <section className="kb-section">
            <h2 className="kb-section-title">解錠機器コードマスタ</h2>
            <div className="kb-device-list">
              {currentDevices.length > 0 ? (
                <table className="kb-device-table">
                  <thead>
                    <tr>
                      <th>Major</th>
                      <th>Minor</th>
                      <th>種類</th>
                      <th>表示名</th>
                      <th>入口</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentDevices.map((d) => (
                      <tr key={d.id}>
                        <td>{d.majorCode}</td>
                        <td>{d.minorCode}</td>
                        <td><span className="kb-device-type-badge">{d.type}</span></td>
                        <td>{d.displayName}</td>
                        <td>{d.isEntrance ? "✅" : "-"}</td>
                        <td>
                          <button type="button" onClick={() => removeDevice(d.id)} className="kb-sm-del-btn">削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="kb-empty-box">登録されている機器はありません。</div>
              )}
            </div>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button type="button" onClick={openDeviceModal} className="kb-add-btn primary">＋ 機器を追加</button>
            </div>
          </section>

          {/* 4. マシンリスト */}
          <section className="kb-section">
            <h2 className="kb-section-title">マシンリスト設定</h2>
            <div className="kb-selected-area">
              <div className="kb-sub-title">現在の構成 ({currentMachines.length}台)</div>
              {currentMachines.length === 0 ? (
                <div className="kb-empty-box">選択されていません。</div>
              ) : (
                <div className="kb-selected-list">
                  {currentMachines.map((m) => (
                    <div key={m.name} className="kb-selected-item animate-fade-in">
                      <img src={m.imageUrl} alt="" className="kb-mini-thumb" />
                      <span className="kb-mini-name">{m.name}</span>
                      <button type="button" onClick={() => removeMachine(m.name)} className="kb-del-btn">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="kb-selector-container">
              <div className="kb-maker-tabs">
                {MAKER_ORDER.map((maker) => (
                  <button key={maker} type="button" onClick={() => setActiveMaker(maker)} className={`kb-maker-btn ${activeMaker === maker ? "active" : ""}`}>{maker}</button>
                ))}
              </div>
              <div className="kb-category-scroll">
                {availableCategories.map((cat) => (
                  <button key={cat} type="button" onClick={() => setActiveCategory(cat)} className={`kb-category-chip ${activeCategory === cat ? "active" : ""}`}>{cat}</button>
                ))}
              </div>
              <div className="kb-machine-grid-wrapper">
                <div className="kb-machine-grid">
                  {getCurrentCategoryItems().map((m) => {
                    const isSelected = currentMachines.some((cm) => cm.name === m.name);
                    return (
                      <button key={m.name} type="button" onClick={() => toggleMachine(m.name, m.img)} className={`kb-machine-card ${isSelected ? "selected" : ""}`}>
                        <div className="kb-card-img-wrap">
                          <img src={m.img} alt={m.name} />
                          {isSelected && <div className="kb-selected-overlay"><span className="kb-check-mark">✓</span></div>}
                        </div>
                        <div className="kb-card-body">
                          <div className="kb-card-name">{m.name}</div>
                          <div className={`kb-status-text ${isSelected ? "on" : "off"}`}>{isSelected ? "選択中" : "未選択"}</div>
                        </div>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setIsMachineModalOpen(true)} className="kb-machine-card add-card">
                    <div className="kb-add-icon">＋</div>
                    <div className="kb-add-text">新規追加</div>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="kb-meta-info">最終更新: {form.updatedAt || "-"}</div>
        </form>
      </main>

      {/* マシン追加モーダル */}
      {isMachineModalOpen && (
        <div className="kb-modal-backdrop" onClick={() => setIsMachineModalOpen(false)}>
          <div className="kb-modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="kb-modal-title">新規マシンマスタ登録</h3>
            <div className="kb-modal-form">
              <div className="kb-modal-field">
                <label>マシン名 <span className="req">*</span></label>
                <input type="text" className="kb-input" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="マシン名" />
              </div>
              <div className="kb-modal-field">
                <label>写真を選択</label>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} />
                {customImage && <div className="kb-img-preview-box"><img src={customImage} alt="Preview" /></div>}
              </div>
            </div>
            <div className="kb-modal-actions">
              <button type="button" className="kb-modal-cancel" onClick={() => setIsMachineModalOpen(false)}>キャンセル</button>
              <button type="button" className="kb-modal-submit" onClick={handleRegisterMaster} disabled={!customName.trim()}>登録</button>
            </div>
          </div>
        </div>
      )}

      {/* 解錠機器追加モーダル */}
      {isDeviceModalOpen && (
        <div className="kb-modal-backdrop" onClick={() => setIsDeviceModalOpen(false)}>
          <div className="kb-modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="kb-modal-title">解錠機器を追加</h3>
            <div className="kb-modal-form">
              <div className="kb-modal-field">
                <label>表示名 <span className="req">*</span></label>
                <input type="text" className="kb-input" value={newDevice.displayName} onChange={e => setNewDevice({...newDevice, displayName: e.target.value})} placeholder="例: 女性用更衣室入口" />
              </div>
              <div className="kb-grid-2">
                <div className="kb-modal-field">
                  <label>Major Code <span className="req">*</span></label>
                  <input type="text" className="kb-input" value={newDevice.majorCode} onChange={e => setNewDevice({...newDevice, majorCode: e.target.value})} />
                </div>
                <div className="kb-modal-field">
                  <label>Minor Code <span className="req">*</span></label>
                  <input type="text" className="kb-input" value={newDevice.minorCode} onChange={e => setNewDevice({...newDevice, minorCode: e.target.value})} />
                </div>
              </div>
              <div className="kb-modal-field">
                <label>種類</label>
                <select className="kb-input" value={newDevice.type} onChange={e => setNewDevice({...newDevice, type: e.target.value as UnlockDeviceType})}>
                  <option value="入口">入口</option>
                  <option value="出口">出口</option>
                  <option value="更衣室">更衣室</option>
                  <option value="水素水">水素水</option>
                </select>
              </div>
              <div className="kb-checkbox-row">
                <input type="checkbox" id="isEntrance" checked={newDevice.isEntrance} onChange={e => setNewDevice({...newDevice, isEntrance: e.target.checked})} />
                <label htmlFor="isEntrance">入口フラグ (入館処理を行う)</label>
              </div>
            </div>
            <div className="kb-modal-actions">
              <button type="button" className="kb-modal-cancel" onClick={() => setIsDeviceModalOpen(false)}>キャンセル</button>
              <button type="button" className="kb-modal-submit" onClick={handleAddDevice}>追加</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; padding-bottom: 80px; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 900px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-save-btn { background: #3b82f6; color: #fff; border: none; padding: 8px 20px; border-radius: 99px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .kb-save-btn:hover:not(:disabled) { background: #2563eb; }
        .kb-save-btn:disabled { background: #cbd5e1; cursor: not-allowed; }

        .kb-main-container { max-width: 900px; margin: 32px auto; padding: 0 24px; }
        .kb-form-grid { display: flex; flex-direction: column; gap: 24px; }
        .kb-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .kb-section-title { margin: 0 0 16px 0; font-size: 18px; font-weight: 800; color: #1e293b; border-left: 4px solid #3b82f6; padding-left: 12px; }
        
        .kb-form-row { margin-bottom: 20px; }
        .kb-form-row-group { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .kb-form-row label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 6px; }
        .kb-input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; background: #fff; }
        .kb-divider { height: 1px; background: #e2e8f0; margin: 24px 0; }

        /* Appメール複数登録用スタイル */
        .kb-email-list { display: flex; flex-direction: column; gap: 8px; }
        .kb-email-row { display: flex; gap: 8px; align-items: center; }
        .kb-email-remove { background: #fee2e2; border: none; color: #ef4444; min-width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 18px; font-weight: bold; }
        .kb-email-add-btn { align-self: flex-start; background: none; border: 1px dashed #cbd5e1; color: #64748b; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: 0.2s; }
        .kb-email-add-btn:hover { border-color: #3b82f6; color: #3b82f6; }

        .kb-geo-input-group { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; }
        .kb-geo-btn { background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }

        .kb-toggle-list { display: flex; flex-direction: column; gap: 16px; }
        .kb-toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .kb-toggle-info { padding-right: 16px; }
        .kb-toggle-label { font-size: 14px; font-weight: 700; color: #334155; }
        .kb-toggle-desc { font-size: 12px; color: #94a3b8; }
        .kb-toggle-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
        .kb-toggle-switch input { opacity: 0; width: 0; height: 0; }
        .kb-toggle-switch label { position: absolute; cursor: pointer; inset: 0; background-color: #cbd5e1; transition: .4s; border-radius: 34px; }
        .kb-toggle-switch label:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        .kb-toggle-switch input:checked + label { background-color: #3b82f6; }
        .kb-toggle-switch input:checked + label:before { transform: translateX(20px); }

        .kb-device-list { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
        .kb-device-table { width: 100%; border-collapse: collapse; min-width: 500px; }
        .kb-device-table th { background: #f8fafc; text-align: left; padding: 10px 16px; font-size: 12px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
        .kb-device-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .kb-device-type-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; background: #eff6ff; color: #3b82f6; font-size: 11px; }
        .kb-sm-del-btn { color: #ef4444; background: none; border: 1px solid #fee2e2; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
        .kb-add-btn.primary { background: #3b82f6; color: #fff; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; }

        .kb-modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000; backdrop-filter: blur(4px); }
        .kb-modal-content { background: #fff; width: 90%; max-width: 480px; padding: 32px; border-radius: 16px; }
        .kb-modal-title { margin: 0 0 16px 0; font-size: 20px; font-weight: 800; color: #1e293b; }
        .kb-modal-field { margin-bottom: 16px; }
        .kb-modal-field label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 6px; }
        .kb-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .kb-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-top: 20px; }
        
        .kb-selected-area { background: #f1f5f9; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
        .kb-sub-title { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 12px; }
        .kb-selected-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .kb-selected-item { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #cbd5e1; padding: 4px 8px 4px 4px; border-radius: 99px; font-size: 13px; color: #334155; }
        .kb-mini-thumb { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
        .kb-del-btn { background: #fee2e2; border: none; color: #ef4444; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 14px; }

        .kb-selector-container { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        .kb-maker-tabs { display: flex; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
        .kb-maker-btn { flex: 1; padding: 14px 0; background: transparent; border: none; font-size: 14px; font-weight: 700; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; }
        .kb-maker-btn.active { background: #fff; color: #3b82f6; border-bottom-color: #3b82f6; }
        .kb-category-scroll { display: flex; gap: 8px; overflow-x: auto; padding: 12px 16px; background: #fff; border-bottom: 1px solid #f1f5f9; white-space: nowrap; scrollbar-width: none; }
        .kb-category-chip { padding: 6px 14px; border-radius: 99px; font-size: 12px; font-weight: 600; border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; }
        .kb-category-chip.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
        
        .kb-machine-grid-wrapper { padding: 20px; background: #fff; min-height: 200px; }
        .kb-machine-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
        .kb-machine-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; cursor: pointer; position: relative; text-align: left; padding: 0; transition: 0.2s; }
        .kb-machine-card.selected { border: 2px solid #3b82f6; background: #eff6ff; }
        .kb-card-img-wrap { width: 100%; aspect-ratio: 4/3; position: relative; background: #f8fafc; }
        .kb-card-img-wrap img { width: 100%; height: 100%; object-fit: cover; }
        .kb-selected-overlay { position: absolute; inset: 0; background: rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; }
        .kb-check-mark { background: #fff; color: #3b82f6; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; }
        .kb-card-body { padding: 12px; }
        .kb-card-name { font-size: 13px; font-weight: 700; color: #1e293b; line-height: 1.4; }
        .kb-status-text { font-size: 11px; font-weight: 600; margin-top: 4px; }
        .kb-status-text.on { color: #3b82f6; }
        .kb-status-text.off { color: #94a3b8; }
        .add-card { border: 2px dashed #cbd5e1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8fafc; color: #64748b; }
        .kb-add-icon { font-size: 32px; font-weight: 300; }
        .kb-add-text { font-size: 12px; font-weight: 700; }
        .kb-img-preview-box { margin-top: 10px; width: 100%; height: 160px; background: #f1f5f9; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
        .kb-img-preview-box img { width: 100%; height: 100%; object-fit: contain; }
        .kb-modal-actions { margin-top: 32px; display: flex; justify-content: flex-end; gap: 12px; }
        .kb-modal-cancel { background: #fff; border: 1px solid #cbd5e1; padding: 10px 20px; border-radius: 8px; font-weight: 700; color: #64748b; cursor: pointer; }
        .kb-modal-submit { background: #3b82f6; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; color: #fff; cursor: pointer; }
        .kb-modal-submit:disabled { background: #cbd5e1; cursor: not-allowed; }
        .kb-meta-info { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 20px; }
        @media (max-width: 640px) { .kb-form-row-group { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}