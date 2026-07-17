"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminLoadingOverlay from "@/components/AdminLoadingOverlay";
import { ToastProvider, useToast } from "@/components/Toast";
import StoreSelector from "@/components/StoreSelector";
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
  inquiryEmails: [""],
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

const TOGGLE_GROUPS = [
  {
    group: "ポイント・プロモーション",
    items: [
      { key: "isPointSupported", label: "ポイント対応可能フラグ", desc: "ポイントシステムを有効化します", dateKey: "pointSupportStartDate" as const },
      { key: "appPointPopup", label: "アプリ内ポイントポップアップ表示フラグ", desc: "アプリ内でポイントのポップアップを表示します" },
      { key: "enableReferral", label: "ベアレージポイント、友達紹介機能有効化切り替え", desc: "APP機能を有効化します" },
    ],
  },
  {
    group: "会員管理",
    items: [
      { key: "canUseDormantMember", label: "休会会員利用可能フラグ", desc: "休会時に月に1度だけ施設を利用できるようにします" },
      { key: "lesMillsAvailable", label: "レズミルズ会員利用可否フラグ", desc: "レズミルズ会員の利用を許可します" },
      { key: "showFamilyAdd", label: "家族会員追加表示切り替え", desc: "APPで家族会員を追加できるようにします" },
    ],
  },
  {
    group: "契約・お手続き",
    items: [
      { key: "showMainContractChange", label: "各種お手続き画面：主契約変更表示非表示切り替え", desc: "主契約変更表示をします。" },
      { key: "showKioskContractChange", label: "KIOSK：主契約変更表示切り替え", desc: "KIOSKで主契約変更表示をします" },
      { key: "showOptionChange", label: "オプション追加・解約表示切り替え", desc: "APPでオプション追加、解約できるようにします" },
    ],
  },
  {
    group: "支払い・退会",
    items: [
      { key: "showUnpaidPayment", label: "未納金表示切り替え", desc: "APPで未納金のお支払い機能を有効化します" },
      { key: "showWithdrawal", label: "退会表示切り替え", desc: "APPで退会機能を有効化します" },
    ],
  },
];
const ALL_TOGGLE_ITEMS = TOGGLE_GROUPS.flatMap((g) => g.items);

type MasterMachine = { name: string; bodyRegion: string; imageUrl: string; maker: string };

// 会員アプリの部位表示は member-app-server の固定定数(MyConst.BODY_REGION)に依存するため、
// 登録時の部位はこの7種から選択させる (これ以外はアプリのマシン画面に出ない)。
const VALID_BODY_REGIONS = ["肩", "腕", "胸", "お腹", "背中", "腰", "脚"];

const SECTIONS = [
  { id: "store-info", label: "店舗情報" },
  { id: "store-settings", label: "店舗設定" },
  { id: "unlock-devices", label: "解錠機器" },
  { id: "machine-list", label: "マシンリスト" },
];

// 種類ごとに固定色を返す
const DEVICE_TYPE_PALETTE = [
  { bg: "#eff6ff", fg: "#1d4ed8" },  // 青
  { bg: "#fef2f2", fg: "#dc2626" },  // 赤
  { bg: "#ecfdf5", fg: "#059669" },  // 緑
  { bg: "#fff7ed", fg: "#c2410c" },  // オレンジ
  { bg: "#fdf2f8", fg: "#be185d" },  // ピンク
  { bg: "#ecfeff", fg: "#0891b2" },  // シアン
  { bg: "#f5f3ff", fg: "#6d28d9" },  // 紫
  { bg: "#fefce8", fg: "#a16207" },  // 黄
  { bg: "#f0fdf4", fg: "#15803d" },  // ライム
  { bg: "#faf5ff", fg: "#7e22ce" },  // バイオレット
];
const _deviceColorCache: Record<string, { bg: string; fg: string }> = {};
function deviceTypeColor(type: string): { bg: string; fg: string } {
  if (_deviceColorCache[type]) return _deviceColorCache[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = ((hash << 5) - hash + type.charCodeAt(i)) | 0;
  const color = DEVICE_TYPE_PALETTE[Math.abs(hash) % DEVICE_TYPE_PALETTE.length];
  _deviceColorCache[type] = color;
  return color;
}

// --- メインコンポーネント ---

function BasicSettingsPageInner({ clubCode }: { clubCode: string }) {
  const { showToast, confirm } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<StoreAppConfig>(DEFAULT_CONFIG);
  const [initialForm, setInitialForm] = useState<string>("");
  const [activeSection, setActiveSection] = useState("store-info");

  // マシンUI状態
  const [masterMachines, setMasterMachines] = useState<MasterMachine[]>([]);
  const [activeMaker, setActiveMaker] = useState<string>("all");
  const [activeRegion, setActiveRegion] = useState<string>("");
  const [machineSearch, setMachineSearch] = useState("");

  // モーダル (解錠機器用)
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [newDevice, setNewDevice] = useState<Partial<UnlockDeviceConfig>>({
    majorCode: "", minorCode: "", type: "入口", isEntrance: false, displayName: ""
  });

  // モーダル (マシン追加用)
  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [addingMachine, setAddingMachine] = useState(false);
  const [newMachine, setNewMachine] = useState<{ name: string; maker: string; bodyRegion: string; imageUrl: string }>({
    name: "", maker: "", bodyRegion: "", imageUrl: ""
  });
  // マシン画像アップロード状態
  const [machineImgUploading, setMachineImgUploading] = useState(false);
  const [machineImgError, setMachineImgError] = useState("");

  // バリデーション
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getSafeMachines = (val: any): MachineConfig[] => Array.isArray(val) ? val : [];
  const getSafeDevices = (val: any): UnlockDeviceConfig[] => Array.isArray(val) ? val : [];
  const getSafeEmails = (val: any): string[] => (Array.isArray(val) && val.length > 0) ? val : [""];

  const isDirty = useMemo(() => {
    return JSON.stringify(form) !== initialForm;
  }, [form, initialForm]);

  // フェッチ (clubCode 変更時に再取得)
  useEffect(() => {
    let cancelled = false;
    const fetchConfig = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/store-settings/basic?clubCode=${encodeURIComponent(clubCode)}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          if (data.config) {
            const loaded = {
              ...data.config,
              machines: getSafeMachines(data.config.machines),
              unlockDevices: getSafeDevices(data.config.unlockDevices),
              inquiryEmails: getSafeEmails(data.config.inquiryEmails),
            };
            setForm(loaded);
            setInitialForm(JSON.stringify(loaded));
          }
        } else {
          showToast("設定の読み込みに失敗しました", "error");
        }
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        showToast("設定の読み込みに失敗しました", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchConfig();
    return () => { cancelled = true; };
  }, [clubCode, showToast]);

  // マシンマスタ取得
  useEffect(() => {
    const fetchMachines = async () => {
      try {
        const res = await fetch("/api/store-settings/machines");
        if (res.ok) {
          const data = await res.json();
          const machines = data.machines || [];
          setMasterMachines(machines);
          if (machines.length > 0) {
            const regions = [...new Set(machines.map((m: MasterMachine) => m.bodyRegion))];
            setActiveRegion(regions[0] as string);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchMachines();
  }, []);

  // ページ離脱警告
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!loading && !saving && isDirty) {
          (document.getElementById("settingsForm") as HTMLFormElement | null)?.requestSubmit();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, saving, isDirty]);

  // スクロール監視でアクティブセクション更新
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  // バリデーション
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    // clubName / brand / businessType は店舗マスタ管理 (readonly) のため検証不要
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (form.storeEmail && !emailRegex.test(form.storeEmail)) {
      newErrors.storeEmail = "有効なメールアドレスを入力してください";
    }
    (form.inquiryEmails || []).forEach((email, i) => {
      if (email.trim() && !emailRegex.test(email)) {
        newErrors[`inquiryEmail_${i}`] = "有効なメールアドレスを入力してください";
      }
    });
    // 解錠機器の重複チェック
    const deviceKeys = new Set<string>();
    getSafeDevices(form.unlockDevices).forEach((d) => {
      const key = `${d.majorCode}-${d.minorCode}`;
      if (deviceKeys.has(key)) {
        newErrors.devices = `Major/Minorコードが重複しています: ${key}`;
      }
      deviceKeys.add(key);
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const submittingRef = useRef(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 二重送信ガード: 確認モーダル表示中の連打/Ctrl+S 連打にも対応
    if (submittingRef.current || saving) return;
    if (!validate()) {
      showToast("入力内容にエラーがあります", "error");
      return;
    }
    submittingRef.current = true;
    try {
      const ok = await confirm("設定を保存しますか？", "保存の確認");
      if (!ok) return;
      setSaving(true);
      const cleanedEmails = (form.inquiryEmails || []).filter(email => email.trim() !== "");
      const res = await fetch("/api/store-settings/basic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, inquiryEmails: cleanedEmails }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          showToast("ログインが切れました。再度ログインしてください。", "error");
        } else if (res.status === 403) {
          showToast("この店舗を編集する権限がありません", "error");
        } else {
          showToast(data.error || "保存に失敗しました。もう一度お試しください。", "error");
        }
        return;
      }
      showToast("設定を保存しました", "success");
      const data = await res.json();
      if (data.config) {
        const saved = { ...data.config, inquiryEmails: getSafeEmails(data.config.inquiryEmails) };
        setForm(saved);
        setInitialForm(JSON.stringify(saved));
      }
    } catch (e) {
      console.error(e);
      showToast("保存に失敗しました。もう一度お試しください。", "error");
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
  };

  // --- メール関連 ---
  const handleInquiryEmailChange = (index: number, value: string) => {
    const newEmails = [...(form.inquiryEmails || [""])];
    newEmails[index] = value;
    setForm({ ...form, inquiryEmails: newEmails });
    if (errors[`inquiryEmail_${index}`]) setErrors((prev) => { const n = { ...prev }; delete n[`inquiryEmail_${index}`]; return n; });
  };
  const addInquiryEmail = () => setForm({ ...form, inquiryEmails: [...(form.inquiryEmails || []), ""] });
  const removeInquiryEmail = (index: number) => {
    const current = [...(form.inquiryEmails || [""])];
    if (current.length <= 1) setForm({ ...form, inquiryEmails: [""] });
    else setForm({ ...form, inquiryEmails: current.filter((_, i) => i !== index) });
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) { showToast("お使いのブラウザでは位置情報がサポートされていません", "warning"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(prev => ({ ...prev, latitude: parseFloat(pos.coords.latitude.toFixed(6)), longitude: parseFloat(pos.coords.longitude.toFixed(6)) }));
        showToast("現在地を取得しました", "success");
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED ? "位置情報の利用が許可されていません" :
          err.code === err.POSITION_UNAVAILABLE ? "位置情報を取得できませんでした" :
          err.code === err.TIMEOUT ? "位置情報の取得がタイムアウトしました" :
          "位置情報の取得に失敗しました";
        showToast(msg, "error");
      }
    );
  };

  // --- マシン関連 ---
  const toggleMachine = (machine: { name: string; imageUrl: string; maker?: string; bodyRegion?: string }) => {
    setForm((prev) => {
      const current = getSafeMachines(prev.machines);
      const exists = current.some((m) => m.name === machine.name);
      if (exists) return { ...prev, machines: current.filter((m) => m.name !== machine.name) };
      return { ...prev, machines: [...current, { name: machine.name, imageUrl: machine.imageUrl, maker: machine.maker, bodyRegion: machine.bodyRegion }] };
    });
  };
  const removeMachine = (machineName: string) => {
    setForm((prev) => ({ ...prev, machines: getSafeMachines(prev.machines).filter((m) => m.name !== machineName) }));
  };

  // マスタに無いマシンをローカル追加 (+ 現在の店舗マシンにも自動選択)
  const openMachineModal = () => {
    setNewMachine({
      name: "",
      maker: activeMaker !== "all" ? activeMaker : "",
      bodyRegion: activeRegion || "",
      imageUrl: "",
    });
    setMachineImgError("");
    setIsMachineModalOpen(true);
  };

  // マシン画像を S3 へアップロードして公開URLを imageUrl にセット
  const handleMachineImageUpload = async (file: File | null) => {
    if (!file) return;
    setMachineImgError("");
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) { setMachineImgError("PNG / JPEG / WebP / GIF のみアップロードできます。"); return; }
    if (file.size > 10 * 1024 * 1024) { setMachineImgError("ファイルサイズは 10MB 以内にしてください。"); return; }
    setMachineImgUploading(true);
    try {
      const initRes = await fetch("/api/store-settings/media/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      const init = await initRes.json();
      if (!initRes.ok || !init.ok) throw new Error(init?.error || "アップロード準備に失敗しました");
      const putRes = await fetch(init.presignedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error("S3 へのアップロードに失敗しました");
      setNewMachine((prev) => ({ ...prev, imageUrl: init.publicUrl }));
    } catch (e: any) {
      setMachineImgError(e?.message || "アップロードに失敗しました");
    } finally {
      setMachineImgUploading(false);
    }
  };
  const handleAddMachine = async () => {
    const name = newMachine.name.trim();
    const maker = newMachine.maker.trim();
    const bodyRegion = newMachine.bodyRegion.trim();
    if (!name || !maker || !bodyRegion) {
      showToast("マシン名・メーカー・部位を入力してください", "warning");
      return;
    }
    if (!VALID_BODY_REGIONS.includes(bodyRegion)) {
      showToast("部位は選択肢から選んでください（アプリ表示対象のみ）", "warning");
      return;
    }
    setAddingMachine(true);
    try {
      // マシンマスタ(machine__c)へ実登録
      const res = await fetch("/api/store-settings/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, maker, bodyRegion, imageUrl: newMachine.imageUrl.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d?.error || "登録に失敗しました");
      const created = d.machine as MasterMachine; // name は "名前(メーカー)" 形式
      setMasterMachines((prev) => [...prev, created]);
      // 追加と同時に店舗のマシンリストにも入れて即選択状態にする
      setForm((prev) => ({ ...prev, machines: [...getSafeMachines(prev.machines), { name: created.name, imageUrl: created.imageUrl, maker: created.maker, bodyRegion: created.bodyRegion }] }));
      setActiveMaker(created.maker);
      setActiveRegion(created.bodyRegion);
      setIsMachineModalOpen(false);
      showToast(`${created.name} を登録しました`, "success");
    } catch (e: any) {
      showToast(e?.message || "登録エラー", "error");
    } finally {
      setAddingMachine(false);
    }
  };

  // --- 解錠機器関連 ---
  const openDeviceModal = () => {
    setEditingDeviceId(null);
    setNewDevice({ majorCode: "", minorCode: "", type: "入口", isEntrance: false, displayName: "" });
    setIsDeviceModalOpen(true);
  };
  const openEditDevice = (d: UnlockDeviceConfig) => {
    setEditingDeviceId(d.id);
    setNewDevice({ majorCode: d.majorCode, minorCode: d.minorCode, type: d.type, isEntrance: d.isEntrance, displayName: d.displayName });
    setIsDeviceModalOpen(true);
  };
  const handleSaveDevice = () => {
    if (!newDevice.majorCode || !newDevice.minorCode || !newDevice.displayName) {
      showToast("必須項目を入力してください", "warning");
      return;
    }
    if (!/^\d+$/.test(newDevice.majorCode) || !/^\d+$/.test(newDevice.minorCode)) {
      showToast("Major/Minor は数値で入力してください", "warning");
      return;
    }
    const existing = getSafeDevices(form.unlockDevices);
    // 重複チェック (編集中の自分自身は除外)
    if (existing.some(d => d.majorCode === newDevice.majorCode && d.minorCode === newDevice.minorCode && d.id !== editingDeviceId)) {
      showToast("同じMajor/Minorコードの機器が既に登録されています", "error");
      return;
    }
    if (editingDeviceId) {
      setForm(prev => ({
        ...prev,
        unlockDevices: getSafeDevices(prev.unlockDevices).map(d => d.id === editingDeviceId
          ? { ...d, majorCode: newDevice.majorCode!, minorCode: newDevice.minorCode!, type: newDevice.type as UnlockDeviceType, isEntrance: newDevice.isEntrance || false, displayName: newDevice.displayName! }
          : d),
      }));
      showToast(`${newDevice.displayName} を更新しました`, "success");
    } else {
      const device: UnlockDeviceConfig = {
        id: `dev_${Date.now()}`,
        majorCode: newDevice.majorCode!,
        minorCode: newDevice.minorCode!,
        type: newDevice.type as UnlockDeviceType,
        isEntrance: newDevice.isEntrance || false,
        displayName: newDevice.displayName!,
      };
      setForm(prev => ({ ...prev, unlockDevices: [...getSafeDevices(prev.unlockDevices), device] }));
      showToast(`${device.displayName} を追加しました`, "success");
    }
    setIsDeviceModalOpen(false);
  };
  const removeDevice = async (id: string) => {
    const ok = await confirm("この機器を削除しますか？", "機器の削除");
    if (!ok) return;
    setForm(prev => ({ ...prev, unlockDevices: getSafeDevices(prev.unlockDevices).filter(d => d.id !== id) }));
    showToast("機器を削除しました", "info");
  };

  const currentMachines = getSafeMachines(form.machines);
  const currentDevices = getSafeDevices(form.unlockDevices);

  const makers = useMemo(() => {
    const counts = new Map<string, number>();
    masterMachines.forEach((m) => counts.set(m.maker, (counts.get(m.maker) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [masterMachines]);
  const machinesFilteredByMaker = useMemo(() => {
    if (activeMaker === "all") return masterMachines;
    return masterMachines.filter((m) => m.maker === activeMaker);
  }, [masterMachines, activeMaker]);
  const bodyRegions = useMemo(() => [...new Set(machinesFilteredByMaker.map((m) => m.bodyRegion))], [machinesFilteredByMaker]);

  // メーカー変更時に部位を先頭にリセット
  useEffect(() => {
    if (bodyRegions.length > 0 && !bodyRegions.includes(activeRegion)) {
      setActiveRegion(bodyRegions[0]);
    }
  }, [bodyRegions, activeRegion]);

  const filteredMasterMachines = useMemo(() => {
    let items = machinesFilteredByMaker.filter((m) => m.bodyRegion === activeRegion);
    if (machineSearch.trim()) {
      const q = machineSearch.toLowerCase();
      items = items.filter((m) => m.name.toLowerCase().includes(q));
    }
    return items;
  }, [machinesFilteredByMaker, activeRegion, machineSearch]);

  const enabledToggleCount = ALL_TOGGLE_ITEMS.filter(s => {
    const v = form[s.key as keyof StoreAppConfig];
    return typeof v === "boolean" ? v : Boolean(v);
  }).length;

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="kbs-root">
      <AdminLoadingOverlay visible={loading || saving} text={saving ? "保存中..." : "読み込み中..."} />

      {/* ヘッダー */}
      <header className="kbs-header">
        <div className="kbs-header-inner">
          <div className="kbs-header-left">
            <Link href={`/store-settings/basic?clubCode=${clubCode}`} className="kbs-back-link">
              <span className="kbs-back-arrow">←</span>
              <span>メニューへ戻る</span>
            </Link>
          </div>
          <div className="kbs-header-center">
            <h1 className="kbs-page-title">アプリ基本設定</h1>
          </div>
          <div className="kbs-header-right">
            {isDirty && (
              <span className="kbs-unsaved-badge">未保存の変更あり</span>
            )}
            <button
              type="submit"
              form="settingsForm"
              className={`kbs-save-btn ${isDirty ? "active" : ""}`}
              disabled={loading || saving || !isDirty}
            >
              保存する
            </button>
          </div>
        </div>
      </header>

      {/* セクションナビ */}
      <nav className="kbs-section-nav">
        <div className="kbs-section-nav-inner">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`kbs-nav-item ${activeSection === s.id ? "active" : ""}`}
              onClick={() => scrollToSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="kbs-main">
        <form id="settingsForm" onSubmit={handleSubmit} className="kbs-form-stack">

          {/* 1. 店舗情報 */}
          <section id="store-info" className="kbs-card">
            <div className="kbs-card-header">
              <div>
                <h2 className="kbs-card-title">店舗情報</h2>
                <p className="kbs-card-subtitle">店舗の基本情報を設定します</p>
              </div>
            </div>
            <div className="kbs-card-body">
              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">ブランド</label>
                  <select name="brand" value={form.brand} className="kbs-select readonly" disabled>
                    <option value="FIT365">FIT365</option>
                    <option value="JOYFIT">JOYFIT</option>
                  </select>
                  <span className="kbs-help-text">店舗マスタにより自動管理</span>
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">業態</label>
                  <select name="businessType" value={form.businessType} className="kbs-select readonly" disabled>
                    <option value="">選択してください</option>
                    {BUSINESS_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                  <span className="kbs-help-text">店舗マスタにより自動管理</span>
                </div>
              </div>

              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">クラブコード</label>
                  <input type="text" name="clubCode" value={form.clubCode} className="kbs-input readonly" readOnly />
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">クラブ名</label>
                  <input type="text" name="clubName" value={form.clubName} className="kbs-input readonly" readOnly />
                  <span className="kbs-help-text">店舗マスタにより自動管理</span>
                </div>
              </div>

              <div className="kbs-field">
                <label className="kbs-label">店舗メールアドレス (マスター)</label>
                <input type="email" name="storeEmail" value={form.storeEmail || ""} onChange={handleChange} className={`kbs-input ${errors.storeEmail ? "has-error" : ""}`} placeholder="店舗代表アドレス" />
                {errors.storeEmail && <span className="kbs-error-text">{errors.storeEmail}</span>}
              </div>

              <div className="kbs-field">
                <label className="kbs-label">App上の問い合わせメール先設定</label>
                <div className="kbs-email-compact">
                  {(form.inquiryEmails || [""]).map((email, index) => (
                    <div key={index} className="kbs-email-chip-row">
                      <input
                        type="email"
                        className={`kbs-email-chip-input ${errors[`inquiryEmail_${index}`] ? "has-error" : ""}`}
                        value={email}
                        onChange={(e) => handleInquiryEmailChange(index, e.target.value)}
                        placeholder="メールアドレス"
                      />
                      <button type="button" className="kbs-email-chip-del" onClick={() => removeInquiryEmail(index)} title="削除">×</button>
                    </div>
                  ))}
                  <button type="button" className="kbs-email-chip-add" onClick={addInquiryEmail}>+ 追加</button>
                </div>
              </div>

              <div className="kbs-separator" />

              <div className="kbs-field">
                <label className="kbs-label">所在地 (緯度・経度)</label>
                <div className="kbs-geo-group">
                  <div className="kbs-geo-input">
                    <span className="kbs-geo-prefix">緯度</span>
                    <input type="number" step="any" name="latitude" value={form.latitude || ""} onChange={handleChange} className="kbs-input" placeholder="35.6812" />
                  </div>
                  <div className="kbs-geo-input">
                    <span className="kbs-geo-prefix">経度</span>
                    <input type="number" step="any" name="longitude" value={form.longitude || ""} onChange={handleChange} className="kbs-input" placeholder="139.7671" />
                  </div>
                  <button type="button" onClick={handleGetCurrentLocation} className="kbs-geo-btn">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    現在地から取得
                  </button>
                </div>
              </div>

              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">都道府県</label>
                  <select name="prefecture" value={form.prefecture || ""} onChange={handleChange} className="kbs-select">
                    <option value="">選択</option>
                    {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">住所</label>
                  <input type="text" name="address" value={form.address || ""} onChange={handleChange} className="kbs-input" placeholder="市区町村・番地" />
                </div>
              </div>

              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">外部リンク(店舗HP)</label>
                  <input type="url" name="externalLink" value={form.externalLink || ""} onChange={handleChange} className="kbs-input" placeholder="https://" />
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">パーソナルトレーニングURL</label>
                  <input type="url" name="personalTrainingUrl" value={form.personalTrainingUrl || ""} onChange={handleChange} className="kbs-input" placeholder="https://" />
                </div>
              </div>
            </div>
          </section>

          {/* 2. 店舗設定 */}
          <section id="store-settings" className="kbs-card">
            <div className="kbs-card-header">
              <div>
                <h2 className="kbs-card-title">店舗設定</h2>
                <p className="kbs-card-subtitle">各機能の有効・無効を切り替えます</p>
              </div>
              <div className="kbs-toggle-counter">
                <span className="kbs-counter-num">{enabledToggleCount}</span>
                <span className="kbs-counter-label">/ {ALL_TOGGLE_ITEMS.length} 有効</span>
              </div>
            </div>
            <div className="kbs-card-body no-padding">
              {TOGGLE_GROUPS.map((group) => (
                <div key={group.group} className="kbs-toggle-group">
                  <div className="kbs-toggle-group-header">{group.group}</div>
                  <div className="kbs-toggle-list">
                    {group.items.map((setting, idx) => (
                      <div key={setting.key} className={`kbs-toggle-row ${idx % 2 === 0 ? "even" : ""}`}>
                        <div className="kbs-toggle-info">
                          <div className="kbs-toggle-label">{setting.label}</div>
                          <div className="kbs-toggle-desc">{setting.desc}</div>
                          {"dateKey" in setting && setting.dateKey && (
                            <div className="kbs-toggle-date">
                              <label className="kbs-toggle-date-label">開始日:</label>
                              <input
                                type="date"
                                name={setting.dateKey}
                                value={(form as any)[setting.dateKey] || ""}
                                onChange={handleChange}
                                className="kbs-toggle-date-input"
                              />
                            </div>
                          )}
                        </div>
                        <div className="kbs-switch">
                          <input
                            type="checkbox"
                            id={setting.key}
                            name={setting.key}
                            checked={(form as any)[setting.key] || false}
                            onChange={handleChange}
                          />
                          <label htmlFor={setting.key}>
                            <span className="kbs-switch-knob" />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 3. 解錠機器設定 */}
          <section id="unlock-devices" className="kbs-card">
            <div className="kbs-card-header">
              <div>
                <h2 className="kbs-card-title">解錠機器コードマスタ</h2>
                <p className="kbs-card-subtitle">Bluetooth / NFC 解錠機器を管理します</p>
              </div>
              <button type="button" onClick={openDeviceModal} className="kbs-header-action-btn">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                機器を追加
              </button>
            </div>
            <div className="kbs-card-body no-padding">
              {errors.devices && <div className="kbs-error-banner">{errors.devices}</div>}
              {currentDevices.length > 0 ? (
                <div className="kbs-table-wrap">
                  <table className="kbs-table">
                    <thead>
                      <tr>
                        <th>表示名</th>
                        <th>種類</th>
                        <th>Major</th>
                        <th>Minor</th>
                        <th>入口</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentDevices.map((d) => (
                        <tr key={d.id}>
                          <td className="kbs-td-name">{d.displayName}</td>
                          <td><span className="kbs-badge-auto" style={{ background: deviceTypeColor(d.type).bg, color: deviceTypeColor(d.type).fg }}>{d.type}</span></td>
                          <td><code className="kbs-code">{d.majorCode}</code></td>
                          <td><code className="kbs-code">{d.minorCode}</code></td>
                          <td>{d.isEntrance ? <span className="kbs-badge green">入館</span> : <span className="kbs-text-muted">-</span>}</td>
                          <td style={{ display: "flex", gap: 6 }}>
                            <button type="button" onClick={() => openEditDevice(d)} className="kbs-icon-btn" title="編集">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            <button type="button" onClick={() => removeDevice(d.id)} className="kbs-icon-btn danger-subtle" title="削除">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="kbs-empty-state">
                  <div className="kbs-empty-text">登録されている機器はありません</div>
                  <button type="button" onClick={openDeviceModal} className="kbs-empty-action">機器を追加する</button>
                </div>
              )}
            </div>
          </section>

          {/* 4. マシンリスト */}
          <section id="machine-list" className="kbs-card">
            <div className="kbs-card-header">
              <div>
                <h2 className="kbs-card-title">マシンリスト設定</h2>
                <p className="kbs-card-subtitle">店舗に設置されているマシンを管理します</p>
              </div>
            </div>
            <div className="kbs-card-body">
              {/* 選択済みマシン */}
              <div className="kbs-selected-area">
                <div className="kbs-selected-header">
                  <span className="kbs-selected-title">現在の構成</span>
                  <span className="kbs-selected-count">{currentMachines.length} 台</span>
                </div>
                {currentMachines.length === 0 ? (
                  <div className="kbs-empty-inline">マシンが選択されていません。下のリストからマシンを追加してください。</div>
                ) : (
                  <div className="kbs-chip-list">
                    {currentMachines.map((m) => (
                      <div key={m.name} className="kbs-chip">
                        {m.imageUrl && <img src={m.imageUrl} alt="" className="kbs-chip-img" />}
                        <span className="kbs-chip-name">{m.name}</span>
                        <button type="button" onClick={() => removeMachine(m.name)} className="kbs-chip-remove">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* マシンセレクター */}
              <div className="kbs-selector">
                {/* メーカータブ */}
                <div className="kbs-maker-tabs">
                  <button type="button" onClick={() => { setActiveMaker("all"); }} className={`kbs-maker-tab ${activeMaker === "all" ? "active" : ""}`}>
                    全メーカー
                  </button>
                  {makers.map((maker) => (
                    <button key={maker} type="button" onClick={() => { setActiveMaker(maker); }} className={`kbs-maker-tab ${activeMaker === maker ? "active" : ""}`}>
                      {maker}
                    </button>
                  ))}
                </div>

                {/* 部位タブ + 検索 */}
                <div className="kbs-selector-toolbar">
                  <div className="kbs-category-scroll">
                    {bodyRegions.map((region) => (
                      <button key={region} type="button" onClick={() => setActiveRegion(region)} className={`kbs-cat-chip ${activeRegion === region ? "active" : ""}`}>
                        {region}
                      </button>
                    ))}
                  </div>
                  <div className="kbs-toolbar-row">
                    <div className="kbs-search-box">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="kbs-search-icon"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" /><path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      <input
                        type="text"
                        placeholder="マシン名で検索..."
                        value={machineSearch}
                        onChange={(e) => setMachineSearch(e.target.value)}
                        className="kbs-search-input"
                      />
                      {machineSearch && (
                        <button type="button" onClick={() => setMachineSearch("")} className="kbs-search-clear">×</button>
                      )}
                    </div>
                    <button type="button" onClick={openMachineModal} className="kbs-m-add-btn">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                      マシンを追加
                    </button>
                  </div>
                </div>

                {/* マシングリッド */}
                <div className="kbs-machine-grid">
                  {filteredMasterMachines.map((m) => {
                    const isSelected = currentMachines.some((cm) => cm.name === m.name);
                    return (
                      <button key={m.name} type="button" onClick={() => toggleMachine(m)} className={`kbs-m-card ${isSelected ? "selected" : ""}`}>
                        <div className="kbs-m-img-wrap">
                          {m.imageUrl ? (
                            <img src={m.imageUrl} alt={m.name} />
                          ) : (
                            <div className="kbs-m-no-img">{m.name.slice(0, 2)}</div>
                          )}
                          {isSelected && (
                            <div className="kbs-m-overlay">
                              <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="white" /><path d="M10 16l4 4 8-8" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                          )}
                        </div>
                        <div className="kbs-m-body">
                          <div className="kbs-m-name">{m.name}</div>
                          <div className={`kbs-m-status ${isSelected ? "on" : ""}`}>
                            {isSelected ? "選択中" : "未選択"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {filteredMasterMachines.length === 0 && (
                    <div className="kbs-m-empty">該当するマシンがありません</div>
                  )}
                  <button type="button" onClick={openMachineModal} className="kbs-m-card add-new" aria-label="マシンを追加">
                    <div className="kbs-m-add-inner">
                      <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="13" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" /><path d="M14 8v12M8 14h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                      <span>マシンを追加</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="kbs-footer-meta">
            最終更新: {form.updatedAt || "-"}
            <span className="kbs-shortcut-hint">Ctrl+S / ⌘+S で保存</span>
          </div>
        </form>
      </main>

      {/* マシン追加モーダル */}
      {isMachineModalOpen && (
        <div className="kbs-modal-backdrop" onClick={() => setIsMachineModalOpen(false)}>
          <div className="kbs-modal" onClick={e => e.stopPropagation()}>
            <div className="kbs-modal-header">
              <h3>マシンを追加</h3>
              <button type="button" className="kbs-modal-close" onClick={() => setIsMachineModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="kbs-modal-body">
              <div className="kbs-field">
                <label className="kbs-label">マシン名 <span className="kbs-req">必須</span></label>
                <input type="text" className="kbs-input" value={newMachine.name} onChange={e => setNewMachine({ ...newMachine, name: e.target.value })} placeholder="例: ラットプルダウン (新型)" />
              </div>
              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">メーカー <span className="kbs-req">必須</span></label>
                  <input type="text" className="kbs-input" list="kbs-maker-list" value={newMachine.maker} onChange={e => setNewMachine({ ...newMachine, maker: e.target.value })} placeholder="例: ライフフィットネス" />
                  <datalist id="kbs-maker-list">
                    {makers.map((mk) => (<option key={mk} value={mk} />))}
                  </datalist>
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">部位 <span className="kbs-req">必須</span></label>
                  <select className="kbs-input" value={newMachine.bodyRegion} onChange={e => setNewMachine({ ...newMachine, bodyRegion: e.target.value })}>
                    <option value="">選択してください</option>
                    {VALID_BODY_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <p className="kbs-hint" style={{ margin: "4px 0 0", fontSize: 11, color: "#94a3b8" }}>会員アプリに表示される部位はこの7種のみです</p>
                  <datalist id="kbs-region-list">
                    {[...new Set(masterMachines.map((m) => m.bodyRegion))].map((r) => (<option key={r} value={r} />))}
                  </datalist>
                </div>
              </div>
              <div className="kbs-field">
                <label className="kbs-label">マシン画像 (任意)</label>
                {newMachine.imageUrl ? (
                  <div className="kbs-mimg-uploaded">
                    <img src={newMachine.imageUrl} alt="" className="kbs-mimg-thumb" />
                    <div className="kbs-mimg-actions">
                      <span className="kbs-mimg-ok">✓ アップロード済み</span>
                      <button type="button" className="kbs-mimg-remove" onClick={() => setNewMachine({ ...newMachine, imageUrl: "" })}>削除</button>
                    </div>
                  </div>
                ) : (
                  <label className={`kbs-mimg-drop${machineImgUploading ? " uploading" : ""}`}>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: "none" }}
                      disabled={machineImgUploading}
                      onChange={(e) => { handleMachineImageUpload(e.target.files?.[0] || null); e.target.value = ""; }} />
                    {machineImgUploading ? (
                      <span>アップロード中...</span>
                    ) : (
                      <>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>クリックして画像を選択</span>
                        <small>PNG / JPEG / WebP / GIF（10MBまで・S3保管）</small>
                      </>
                    )}
                  </label>
                )}
                {machineImgError && <p className="kbs-mimg-err">{machineImgError}</p>}
                <p className="kbs-modal-hint">空欄の場合はマシン名の先頭 2 文字が表示されます。</p>
              </div>
            </div>
            <div className="kbs-modal-footer">
              <button type="button" className="kbs-btn ghost" onClick={() => setIsMachineModalOpen(false)}>キャンセル</button>
              <button type="button" className="kbs-btn primary" onClick={handleAddMachine} disabled={addingMachine}>{addingMachine ? "登録中..." : "登録"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 解錠機器追加モーダル */}
      {isDeviceModalOpen && (
        <div className="kbs-modal-backdrop" onClick={() => setIsDeviceModalOpen(false)}>
          <div className="kbs-modal" onClick={e => e.stopPropagation()}>
            <div className="kbs-modal-header">
              <h3>{editingDeviceId ? "解錠機器を編集" : "解錠機器を追加"}</h3>
              <button type="button" className="kbs-modal-close" onClick={() => setIsDeviceModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5l-10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="kbs-modal-body">
              <div className="kbs-field">
                <label className="kbs-label">表示名 <span className="kbs-req">必須</span></label>
                <input type="text" className="kbs-input" value={newDevice.displayName} onChange={e => setNewDevice({ ...newDevice, displayName: e.target.value })} placeholder="例: 女性用更衣室入口" />
              </div>
              <div className="kbs-field-grid-2">
                <div className="kbs-field">
                  <label className="kbs-label">Major Code <span className="kbs-req">必須</span></label>
                  <input type="text" className="kbs-input" value={newDevice.majorCode} onChange={e => setNewDevice({ ...newDevice, majorCode: e.target.value })} />
                </div>
                <div className="kbs-field">
                  <label className="kbs-label">Minor Code <span className="kbs-req">必須</span></label>
                  <input type="text" className="kbs-input" value={newDevice.minorCode} onChange={e => setNewDevice({ ...newDevice, minorCode: e.target.value })} />
                </div>
              </div>
              <div className="kbs-field">
                <label className="kbs-label">種類</label>
                <select className="kbs-select" value={newDevice.type} onChange={e => setNewDevice({ ...newDevice, type: e.target.value as UnlockDeviceType })}>
                  <option value="入口">入口</option>
                  <option value="出口">出口</option>
                  <option value="更衣室">更衣室</option>
                  <option value="水素水">水素水</option>
                </select>
              </div>
              <div className="kbs-checkbox-field">
                <input type="checkbox" id="isEntrance" checked={newDevice.isEntrance} onChange={e => setNewDevice({ ...newDevice, isEntrance: e.target.checked })} />
                <label htmlFor="isEntrance">入口フラグ (入館処理を行う)</label>
              </div>
            </div>
            <div className="kbs-modal-footer">
              <button type="button" className="kbs-btn ghost" onClick={() => setIsDeviceModalOpen(false)}>キャンセル</button>
              <button type="button" className="kbs-btn primary" onClick={handleSaveDevice}>{editingDeviceId ? "更新" : "追加"}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* ===== リセット & ベース ===== */
        .kbs-root {
          background: linear-gradient(160deg, #f0f4ff 0%, #f8fafc 40%, #faf5ff 100%);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
          color: #0f172a;
          padding-bottom: 100px;
        }

        /* ===== ヘッダー ===== */
        .kbs-header {
          height: 64px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(16px) saturate(180%);
          border-bottom: 1px solid rgba(226, 232, 240, 0.8);
          position: sticky;
          top: 0;
          z-index: 200;
        }
        .kbs-header-inner {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kbs-header-left { flex: 1; }
        .kbs-header-center { flex: 0 0 auto; }
        .kbs-header-right { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
        .kbs-back-link {
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 8px;
          transition: 0.15s;
        }
        .kbs-back-link:hover { background: #f1f5f9; color: #334155; }
        .kbs-back-arrow { font-size: 16px; }
        .kbs-page-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; letter-spacing: -0.3px; }
        .kbs-unsaved-badge {
          font-size: 11px;
          font-weight: 700;
          color: #d97706;
          background: linear-gradient(135deg, #fffbeb, #fef3c7);
          border: 1px solid #fcd34d;
          padding: 4px 10px;
          border-radius: 99px;
          animation: pulse-badge 2s ease-in-out infinite;
        }
        @keyframes pulse-badge {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .kbs-save-btn {
          background: #cbd5e1;
          color: #fff;
          border: none;
          padding: 8px 20px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 13px;
          cursor: not-allowed;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .kbs-save-btn.active {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
        }
        .kbs-save-btn.active:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); }

        /* ===== セクションナビ ===== */
        .kbs-section-nav {
          position: sticky;
          top: 64px;
          z-index: 150;
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(12px) saturate(180%);
          border-bottom: 1px solid rgba(226, 232, 240, 0.6);
        }
        .kbs-section-nav-inner {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          gap: 4px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .kbs-section-nav-inner::-webkit-scrollbar { display: none; }
        .kbs-nav-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 16px;
          border: none;
          background: none;
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          cursor: pointer;
          white-space: nowrap;
          border-bottom: 2px solid transparent;
          transition: 0.15s;
        }
        .kbs-nav-item:hover { color: #64748b; }
        .kbs-nav-item.active { color: #3b82f6; border-bottom-color: #3b82f6; }

        /* ===== メインコンテンツ ===== */
        .kbs-main { max-width: 1280px; margin: 0 auto; padding: 28px 24px 0; }
        .kbs-form-stack { display: flex; flex-direction: column; gap: 24px; }

        /* ===== カード ===== */
        .kbs-card {
          background: #fff;
          border: 1px solid rgba(226, 232, 240, 0.8);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02), 0 4px 16px rgba(0, 0, 0, 0.02);
          transition: box-shadow 0.2s;
          scroll-margin-top: 140px;
        }
        .kbs-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.04); }
        .kbs-card-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 20px 24px;
          border-bottom: 1px solid #f1f5f9;
        }
        .kbs-card-title { margin: 0; font-size: 17px; font-weight: 800; color: #1e293b; letter-spacing: -0.3px; }
        .kbs-card-subtitle { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
        .kbs-card-body { padding: 24px; }
        .kbs-card-body.no-padding { padding: 0; }

        /* ===== フォームフィールド ===== */
        .kbs-field { margin-bottom: 20px; }
        .kbs-field:last-child { margin-bottom: 0; }
        .kbs-field-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .kbs-label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 6px; }
        .kbs-req { font-size: 10px; font-weight: 700; color: #fff; background: #ef4444; padding: 1px 6px; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
        .kbs-input, .kbs-select {
          width: 100%;
          padding: 10px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          font-size: 14px;
          background: #fff;
          color: #1e293b;
          transition: 0.15s;
          outline: none;
          box-sizing: border-box;
        }
        .kbs-input:focus, .kbs-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        .kbs-input.readonly, .kbs-select.readonly { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
        .kbs-select:disabled { background: #f8fafc; color: #94a3b8; cursor: not-allowed; }
        .kbs-input.has-error { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1); }
        .kbs-help-text { display: block; font-size: 11px; color: #94a3b8; margin-top: 4px; font-style: italic; }
        .kbs-error-text { display: block; font-size: 12px; color: #ef4444; margin-top: 4px; font-weight: 600; }
        .kbs-error-text.full-width { flex-basis: 100%; }
        .kbs-error-banner { background: #fef2f2; color: #dc2626; padding: 12px 24px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #fee2e2; }
        .kbs-separator { height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent); margin: 24px 0; }

        /* ===== メール ===== */
        .kbs-email-compact { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .kbs-email-chip-row { display: flex; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        .kbs-email-chip-input { border: none; background: transparent; padding: 6px 10px; font-size: 13px; outline: none; min-width: 180px; width: auto; color: #1e293b; }
        .kbs-email-chip-input.has-error { background: #fef2f2; }
        .kbs-email-chip-input:focus { background: #fff; }
        .kbs-email-chip-del { border: none; background: transparent; color: #cbd5e1; cursor: pointer; padding: 6px 8px; font-size: 16px; font-weight: 700; line-height: 1; transition: 0.1s; }
        .kbs-email-chip-del:hover { color: #ef4444; background: #fef2f2; }
        .kbs-email-chip-add { border: 1px dashed #cbd5e1; background: none; color: #94a3b8; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s; }
        .kbs-email-chip-add:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }
        .kbs-icon-btn {
          width: 36px; height: 36px; border-radius: 8px; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.15s; flex-shrink: 0;
        }
        .kbs-icon-btn.danger { background: #fef2f2; color: #ef4444; }
        .kbs-icon-btn.danger:hover { background: #fee2e2; }
        .kbs-icon-btn.danger-subtle { background: transparent; color: #cbd5e1; }
        .kbs-icon-btn.danger-subtle:hover { background: #fef2f2; color: #ef4444; }
        .kbs-add-inline-btn {
          align-self: flex-start;
          background: none;
          border: 1.5px dashed #cbd5e1;
          color: #64748b;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: 0.15s;
        }
        .kbs-add-inline-btn:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }

        /* ===== 位置情報 ===== */
        .kbs-geo-group { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; }
        .kbs-geo-input { position: relative; }
        .kbs-geo-prefix {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          font-size: 11px; font-weight: 700; color: #94a3b8;
        }
        .kbs-geo-input .kbs-input { padding-left: 40px; }
        .kbs-geo-btn {
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          color: #475569;
          padding: 0 16px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: 0.15s;
          white-space: nowrap;
        }
        .kbs-geo-btn:hover { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }

        /* ===== トグル ===== */
        .kbs-toggle-counter { margin-left: auto; display: flex; align-items: baseline; gap: 4px; }
        .kbs-counter-num { font-size: 24px; font-weight: 800; color: #3b82f6; }
        .kbs-counter-label { font-size: 12px; color: #94a3b8; font-weight: 600; }
        .kbs-toggle-group { border-bottom: 1px solid #e2e8f0; }
        .kbs-toggle-group:last-child { border-bottom: none; }
        .kbs-toggle-group-header { padding: 12px 24px 8px; font-size: 11px; font-weight: 800; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.5px; background: #f8fafc; border-bottom: 1px solid #f1f5f9; }
        .kbs-toggle-list { display: flex; flex-direction: column; }
        .kbs-toggle-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 24px;
          transition: 0.1s;
        }
        .kbs-toggle-row.even { background: #fafbfc; }
        .kbs-toggle-row:hover { background: #f0f7ff; }
        .kbs-toggle-info { flex: 1; min-width: 0; }
        .kbs-toggle-label { font-size: 13px; font-weight: 700; color: #334155; }
        .kbs-toggle-desc { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .kbs-toggle-date { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
        .kbs-toggle-date-label { font-size: 11px; font-weight: 600; color: #64748b; white-space: nowrap; }
        .kbs-toggle-date-input { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; color: #475569; outline: none; }
        .kbs-toggle-date-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.08); }

        /* スイッチ */
        .kbs-switch { position: relative; width: 48px; height: 26px; flex-shrink: 0; }
        .kbs-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .kbs-switch label {
          position: absolute; cursor: pointer; inset: 0;
          background: #e2e8f0; transition: 0.3s; border-radius: 26px;
        }
        .kbs-switch-knob {
          position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px;
          background: #fff; transition: 0.3s; border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }
        .kbs-switch input:checked + label { background: linear-gradient(135deg, #3b82f6, #2563eb); }
        .kbs-switch input:checked + label .kbs-switch-knob { transform: translateX(22px); }

        /* ===== テーブル ===== */
        .kbs-table-wrap { overflow-x: auto; }
        .kbs-table { width: 100%; border-collapse: collapse; min-width: 500px; }
        .kbs-table th {
          background: #f8fafc; text-align: left; padding: 12px 20px;
          font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;
          border-bottom: 1px solid #e2e8f0;
        }
        .kbs-table td { padding: 14px 20px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .kbs-table tr:hover td { background: #fafbfe; }
        .kbs-td-name { font-weight: 700; color: #1e293b; }
        .kbs-badge {
          display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700;
        }
        .kbs-badge.blue { background: #eff6ff; color: #2563eb; }
        .kbs-badge.orange { background: #fff7ed; color: #c2410c; }
        .kbs-badge.pink { background: #fdf2f8; color: #be185d; }
        .kbs-badge.cyan { background: #ecfeff; color: #0891b2; }
        .kbs-badge.gray { background: #f1f5f9; color: #475569; }
        .kbs-badge-auto { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }
        .kbs-badge.green { background: #ecfdf5; color: #059669; }
        .kbs-code { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-family: "SF Mono", monospace; color: #475569; }
        .kbs-text-muted { color: #cbd5e1; }

        /* ===== 空状態 ===== */
        .kbs-empty-state { padding: 48px 24px; text-align: center; }
        .kbs-empty-text { font-size: 14px; color: #94a3b8; margin-bottom: 16px; }
        .kbs-empty-action {
          background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border: none;
          padding: 10px 20px; border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25); transition: 0.15s;
        }
        .kbs-empty-action:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35); }
        .kbs-empty-inline { background: #f8fafc; padding: 20px; border-radius: 10px; color: #94a3b8; font-size: 13px; text-align: center; border: 1px dashed #e2e8f0; }

        /* ===== ヘッダーアクションボタン ===== */
        .kbs-header-action-btn {
          margin-left: auto;
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: 0.15s;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
        }
        .kbs-header-action-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }

        /* ===== マシン選択エリア ===== */
        .kbs-selected-area {
          background: linear-gradient(135deg, #f8fafc, #f1f5f9);
          border-radius: 14px;
          padding: 18px;
          margin-bottom: 20px;
          border: 1px solid #e2e8f0;
        }
        .kbs-selected-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .kbs-selected-title { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .kbs-selected-count {
          font-size: 12px; font-weight: 800; color: #3b82f6;
          background: #eff6ff; padding: 3px 10px; border-radius: 99px;
        }
        .kbs-chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .kbs-chip {
          display: flex; align-items: center; gap: 8px;
          background: #fff; border: 1px solid #e2e8f0; padding: 4px 8px 4px 4px;
          border-radius: 99px; font-size: 12px; color: #334155; font-weight: 600;
          transition: 0.15s; animation: chip-in 0.2s ease;
        }
        @keyframes chip-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        .kbs-chip:hover { border-color: #93c5fd; background: #eff6ff; }
        .kbs-chip-img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
        .kbs-chip-remove {
          width: 20px; height: 20px; border-radius: 50%; background: #f1f5f9; border: none;
          color: #94a3b8; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.15s;
        }
        .kbs-chip-remove:hover { background: #fee2e2; color: #ef4444; }

        /* ===== マシンセレクター ===== */
        .kbs-selector { border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
        .kbs-maker-tabs { display: flex; background: #f8fafc; border-bottom: 1px solid #e2e8f0; overflow-x: auto; scrollbar-width: none; }
        .kbs-maker-tabs::-webkit-scrollbar { display: none; }
        .kbs-maker-tab {
          padding: 10px 16px; background: transparent; border: none;
          font-size: 12px; font-weight: 700; color: #94a3b8; cursor: pointer;
          border-bottom: 3px solid transparent; transition: 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .kbs-maker-tab:hover { color: #64748b; background: #fff; }
        .kbs-maker-tab.active { background: #fff; color: #3b82f6; border-bottom-color: #3b82f6; }
        .kbs-selector-toolbar {
          display: flex; flex-direction: column; gap: 8px;
          padding: 12px 16px; border-bottom: 1px solid #f1f5f9; background: #fff;
        }
        .kbs-category-scroll { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
        .kbs-category-scroll::-webkit-scrollbar { display: none; }
        .kbs-cat-chip {
          padding: 6px 14px; border-radius: 99px; font-size: 11px; font-weight: 700;
          border: 1px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer;
          white-space: nowrap; transition: 0.15s;
        }
        .kbs-cat-chip:hover { border-color: #93c5fd; color: #3b82f6; }
        .kbs-cat-chip.active { background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border-color: transparent; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25); }
        .kbs-search-box {
          position: relative; display: flex; align-items: center;
        }
        .kbs-search-icon { position: absolute; left: 12px; color: #94a3b8; pointer-events: none; }
        .kbs-search-input {
          width: 100%; padding: 8px 32px 8px 34px; border: 1.5px solid #e2e8f0; border-radius: 8px;
          font-size: 13px; background: #f8fafc; outline: none; transition: 0.15s;
        }
        .kbs-search-input:focus { border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08); }
        .kbs-search-clear {
          position: absolute; right: 8px; width: 20px; height: 20px; border-radius: 50%;
          background: #e2e8f0; border: none; color: #64748b; font-size: 14px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }

        /* ===== マシングリッド ===== */
        .kbs-machine-grid { padding: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; background: #fff; min-height: 160px; }
        .kbs-m-card {
          background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; overflow: hidden;
          cursor: pointer; text-align: left; padding: 0; transition: all 0.2s; position: relative;
        }
        .kbs-m-card:hover { border-color: #93c5fd; transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06); }
        .kbs-m-card.selected { border: 2px solid #3b82f6; background: #f0f7ff; }
        .kbs-m-card.add-new { border: 2px dashed #cbd5e1; background: #fafbfc; display: flex; align-items: center; justify-content: center; min-height: 180px; }
        .kbs-m-card.add-new:hover { border-color: #3b82f6; background: #eff6ff; transform: none; box-shadow: none; }
        .kbs-m-add-inner { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #94a3b8; font-size: 12px; font-weight: 700; }
        .kbs-m-card.add-new:hover .kbs-m-add-inner { color: #3b82f6; }
        .kbs-toolbar-row { display: flex; gap: 10px; align-items: center; }
        .kbs-toolbar-row .kbs-search-box { flex: 1; }
        .kbs-m-add-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 10px; border: 1.5px dashed #cbd5e1;
          background: #fff; color: #475569; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.15s;
          white-space: nowrap;
        }
        .kbs-m-add-btn:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }
        .kbs-modal-hint { font-size: 11px; color: #94a3b8; margin: 6px 0 0; }
        .kbs-mimg-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 20px 12px; border: 1.5px dashed #cbd5e1; border-radius: 10px; background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 700; cursor: pointer; transition: border-color 0.15s, background 0.15s; text-align: center; }
        .kbs-mimg-drop:hover { border-color: #6366f1; background: #eef2ff; color: #4f46e5; }
        .kbs-mimg-drop.uploading { cursor: default; opacity: 0.8; }
        .kbs-mimg-drop small { font-size: 10px; font-weight: 600; color: #94a3b8; }
        .kbs-mimg-uploaded { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff; }
        .kbs-mimg-thumb { width: 100%; max-height: 180px; object-fit: contain; display: block; background: #f1f5f9; }
        .kbs-mimg-actions { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; }
        .kbs-mimg-ok { font-size: 11px; font-weight: 700; color: #0f766e; }
        .kbs-mimg-remove { border: none; background: none; color: #dc2626; font-size: 11px; font-weight: 800; cursor: pointer; }
        .kbs-mimg-err { font-size: 11px; color: #dc2626; margin: 6px 0 0; font-weight: 600; }
        .kbs-m-img-wrap { width: 100%; aspect-ratio: 4/3; position: relative; background: #f8fafc; overflow: hidden; }
        .kbs-m-img-wrap img { width: 100%; height: 100%; object-fit: cover; transition: 0.3s; }
        .kbs-m-card:hover .kbs-m-img-wrap img { transform: scale(1.05); }
        .kbs-m-overlay {
          position: absolute; inset: 0;
          background: rgba(59, 130, 246, 0.35);
          display: flex; align-items: center; justify-content: center;
          animation: fade-in 0.2s ease;
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .kbs-m-no-img { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #94a3b8; font-size: 20px; font-weight: 800; }
        .kbs-m-empty { grid-column: 1 / -1; text-align: center; padding: 40px; color: #94a3b8; font-size: 13px; }
        .kbs-m-body { padding: 12px 14px; }
        .kbs-m-name { font-size: 12px; font-weight: 700; color: #1e293b; line-height: 1.4; }
        .kbs-m-status { font-size: 10px; font-weight: 700; margin-top: 4px; color: #cbd5e1; }
        .kbs-m-status.on { color: #3b82f6; }

        /* ===== モーダル ===== */
        .kbs-modal-backdrop {
          position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center;
          z-index: 10000; animation: modal-fade-in 0.2s ease;
        }
        @keyframes modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .kbs-modal {
          background: #fff; width: 90%; max-width: 480px; border-radius: 20px;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.15);
          animation: modal-scale-in 0.25s ease;
          overflow: hidden;
        }
        @keyframes modal-scale-in { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .kbs-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 24px; border-bottom: 1px solid #f1f5f9;
        }
        .kbs-modal-header h3 { margin: 0; font-size: 18px; font-weight: 800; color: #1e293b; }
        .kbs-modal-close { background: #f1f5f9; border: none; width: 32px; height: 32px; border-radius: 8px; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.15s; }
        .kbs-modal-close:hover { background: #e2e8f0; color: #334155; }
        .kbs-modal-body { padding: 24px; }
        .kbs-modal-footer { padding: 16px 24px; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 10px; }
        .kbs-checkbox-field { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: #475569; margin-top: 16px; }
        .kbs-checkbox-field input[type="checkbox"] { width: 18px; height: 18px; accent-color: #3b82f6; }

        /* ===== ファイルドロップ ===== */
        .kbs-file-drop {
          border: 2px dashed #e2e8f0; border-radius: 12px; padding: 24px; text-align: center;
          cursor: pointer; transition: 0.15s; min-height: 120px; display: flex; align-items: center; justify-content: center;
        }
        .kbs-file-drop:hover { border-color: #93c5fd; background: #f0f7ff; }
        .kbs-file-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #94a3b8; font-size: 13px; font-weight: 600; }
        .kbs-file-preview { max-width: 100%; max-height: 160px; object-fit: contain; border-radius: 8px; }

        /* ===== ボタン ===== */
        .kbs-btn {
          padding: 10px 22px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; transition: 0.15s; border: none;
        }
        .kbs-btn.primary {
          background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
        }
        .kbs-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35); }
        .kbs-btn.primary:disabled { background: #cbd5e1; box-shadow: none; cursor: not-allowed; transform: none; }
        .kbs-btn.ghost { background: #fff; border: 1.5px solid #e2e8f0; color: #64748b; }
        .kbs-btn.ghost:hover { background: #f8fafc; border-color: #cbd5e1; }

        /* ===== フッター ===== */
        .kbs-footer-meta {
          text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px;
          display: flex; align-items: center; justify-content: center; gap: 16px;
        }
        .kbs-shortcut-hint {
          background: #f1f5f9; padding: 4px 10px; border-radius: 6px;
          font-size: 11px; font-weight: 600; color: #94a3b8;
        }

      `}</style>
    </div>
  );
}

type StoreSummary = {
  clubCode: string;
  clubName: string;
  brand: string;
  businessType: string;
  prefecture: string;
};

function StoreSettingsSubMenu({ clubCode }: { clubCode: string }) {
  const [store, setStore] = useState<StoreSummary | null>(null);
  const [loadingStore, setLoadingStore] = useState(true);

  useEffect(() => {
    const fetchStore = async () => {
      try {
        const res = await fetch("/api/store-settings/stores");
        if (res.ok) {
          const data = await res.json();
          const match = (data.stores || []).find((s: StoreSummary) => s.clubCode === clubCode);
          if (match) setStore(match);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingStore(false);
      }
    };
    fetchStore();
  }, [clubCode]);

  const menuItems = [
    {
      title: "基本設定",
      desc: "店舗情報、ブランド、機能フラグ、解錠機器、マシンリストを管理します。",
      href: `/store-settings/basic?clubCode=${clubCode}&view=settings`,
      color: "#3b82f6",
      iconPath: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    },
    {
      title: "1dayパス / One Time Pass 設定",
      desc: "EnjoyTimePass の現在の料金設定を参照します（読み取り専用）。",
      href: `/store-settings/basic/onetime-pass?clubCode=${clubCode}`,
      color: "#f59e0b",
      iconPath: "M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z",
    },
    {
      title: "ポイント管理",
      desc: "ポイント付与ルール、有効期限、ポイント残高の確認・調整を行います。",
      href: `/store-settings/basic/points?clubCode=${clubCode}`,
      color: "#10b981",
      iconPath: "M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z",
    },
    {
      title: "オプション都度利用",
      desc: "各オプションの都度利用料金・提供状況・販売実績を参照します（読み取り専用）。",
      href: `/store-settings/basic/option-usage?clubCode=${clubCode}`,
      color: "#8b5cf6",
      iconPath: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
    },
    {
      title: "未納金管理",
      desc: "会員別の未納金確認・督促状況の追跡と、全体の未納金サマリーを管理します。",
      href: `/store-settings/basic/unpaid?clubCode=${clubCode}`,
      color: "#ef4444",
      iconPath: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
    },
  ];

  return (
    <div className="kb-store-root">
      <div className="kb-topbar">
        <div className="kb-topbar-inner">
          <Link href="/store-settings/basic" className="kb-back-link">← 店舗選択へ戻る</Link>
          <div style={{ fontWeight: 700 }}>店舗設定メニュー</div>
          <div style={{ width: 120 }} />
        </div>
      </div>

      <main className="kb-main-container">
        <header className="kb-page-header">
          <div className="kb-badge">STORE</div>
          {loadingStore ? (
            <h1>読み込み中...</h1>
          ) : store ? (
            <>
              <h1>
                <span className="kb-store-code">{store.clubCode}</span>
                {store.clubName}
              </h1>
              <p>
                {store.brand}
                {store.businessType ? ` ／ ${store.businessType}` : ""}
                {store.prefecture ? ` ／ ${store.prefecture}` : ""}
              </p>
            </>
          ) : (
            <>
              <h1>クラブコード: {clubCode}</h1>
              <p>店舗情報を取得できませんでした。</p>
            </>
          )}
        </header>

        <div className="kb-store-grid">
          {menuItems.map((item) => {
            const soon = (item as any).comingSoon;
            const card = (
              <div className={`kb-modern-card${soon ? " kb-card-soon" : ""}`}>
                <div className="kb-accent-bar" style={{ backgroundColor: item.color }} />
                {soon && <span className="kb-soon-badge">Coming Soon</span>}
                <div className="kb-card-body">
                  <div
                    className="kb-card-icon-wrapper"
                    style={{ color: item.color, background: `${item.color}15` }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 32, height: 32 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.iconPath} />
                    </svg>
                  </div>
                  <h3 className="kb-card-heading">{item.title}</h3>
                  <p className="kb-card-subtext">{item.desc}</p>
                </div>
                <div className="kb-card-footer">
                  <span className="kb-action-label">{soon ? "準備中" : "設定を開く"}</span>
                  <span className="kb-action-icon">→</span>
                </div>
              </div>
            );
            return soon ? (
              <div key={item.title} className="kb-menu-link kb-menu-disabled" aria-disabled title="準備中です">{card}</div>
            ) : (
              <Link href={item.href} key={item.title} className="kb-menu-link">{card}</Link>
            );
          })}
        </div>
      </main>

      <style jsx global>{`
        .kb-store-root { background-color: #f8fafc; min-height: 100vh; font-family: sans-serif; color: #0f172a; }
        .kb-topbar { height: 60px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; position: sticky; top: 0; z-index: 100; }
        .kb-topbar-inner { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; display: flex; justify-content: space-between; align-items: center; }
        .kb-back-link { text-decoration: none; font-size: 13px; font-weight: 600; color: #64748b; }
        .kb-back-link:hover { color: #334155; }
        .kb-main-container { max-width: 1140px; margin: 0 auto; padding: 40px 24px; }
        .kb-page-header { margin-bottom: 40px; }
        .kb-badge { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: #0f172a; background: #e2e8f0; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
        .kb-page-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .kb-store-code { background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 14px; font-family: "SF Mono", monospace; font-weight: 700; }
        .kb-page-header p { font-size: 14px; color: #64748b; margin: 0; }
        .kb-store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
        .kb-menu-link { text-decoration: none; color: inherit; display: block; height: 100%; }
        .kb-menu-disabled { cursor: not-allowed; }
        .kb-card-soon { opacity: 0.6; filter: grayscale(0.5); }
        .kb-menu-disabled:hover .kb-card-soon { transform: none; box-shadow: none; }
        .kb-soon-badge { position: absolute; top: 10px; right: 10px; z-index: 2; background: #64748b; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 3px 10px; border-radius: 20px; }

        .kb-modern-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; position: relative; height: 100%; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; overflow: hidden; }
        .kb-modern-card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -8px rgba(0,0,0,0.1); border-color: #bfdbfe; }

        .kb-accent-bar { height: 4px; width: 100%; }
        .kb-card-body { padding: 32px; flex: 1; }

        .kb-card-icon-wrapper {
          width: 56px; height: 56px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 20px;
        }

        .kb-card-heading { font-size: 18px; font-weight: 700; margin: 0 0 10px 0; }
        .kb-card-subtext { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0; }
        .kb-card-footer { padding: 16px 32px; background: #fcfdfe; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .kb-action-label { font-size: 12px; font-weight: 700; color: #94a3b8; }
        .kb-action-icon { font-size: 16px; color: #cbd5e1; }
        .kb-modern-card:hover .kb-action-label { color: #3b82f6; }
        .kb-modern-card:hover .kb-action-icon { color: #3b82f6; }
      `}</style>
    </div>
  );
}

function BasicSettingsPageRouter() {
  const searchParams = useSearchParams();
  const clubCode = searchParams.get("clubCode");
  const view = searchParams.get("view");

  if (!clubCode) {
    return (
      <StoreSelector
        basePath="/store-settings/basic"
        title="店舗設定 - 店舗選択"
        backHref="/store-settings"
        backLabel="メニューへ戻る"
      />
    );
  }

  if (view !== "settings") {
    return <StoreSettingsSubMenu clubCode={clubCode} />;
  }

  return (
    <ToastProvider>
      <BasicSettingsPageInner clubCode={clubCode} />
    </ToastProvider>
  );
}

export default function BasicSettingsPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8fafc" }} />}>
      <BasicSettingsPageRouter />
    </Suspense>
  );
}
