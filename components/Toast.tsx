"use client";

import React, { useEffect, useState, useCallback, createContext, useContext } from "react";

type ToastType = "success" | "error" | "info" | "warning";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
};

type ToastContextType = {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  confirm: (message: string, title?: string) => Promise<boolean>;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast, onRemove]);

  const icons: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "i",
    warning: "!",
  };

  const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: { bg: "linear-gradient(135deg, #ecfdf5, #d1fae5)", border: "#6ee7b7", icon: "#059669" },
    error: { bg: "linear-gradient(135deg, #fef2f2, #fee2e2)", border: "#fca5a5", icon: "#dc2626" },
    info: { bg: "linear-gradient(135deg, #eff6ff, #dbeafe)", border: "#93c5fd", icon: "#2563eb" },
    warning: { bg: "linear-gradient(135deg, #fffbeb, #fef3c7)", border: "#fcd34d", icon: "#d97706" },
  };

  const c = colors[toast.type];

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
        animation: exiting ? "toast-exit 0.3s ease forwards" : "toast-enter 0.3s ease forwards",
        backdropFilter: "blur(8px)",
        minWidth: 280,
        maxWidth: 420,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: c.icon,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {icons[toast.type]}
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => { setExiting(true); setTimeout(() => onRemove(toast.id), 300); }}
        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}

type ConfirmState = {
  message: string;
  title: string;
  resolve: (value: boolean) => void;
} | null;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info", duration?: number) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const confirm = useCallback((message: string, title?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, title: title || "確認", resolve });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ showToast, confirm }}>
      {children}

      {/* Toast container */}
      <div style={{ position: "fixed", top: 24, right: 24, zIndex: 99999, display: "flex", flexDirection: "column", gap: 10 }}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100000,
            animation: "modal-fade-in 0.2s ease",
          }}
          onClick={() => handleConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "32px 36px",
              maxWidth: 400,
              width: "90%",
              boxShadow: "0 24px 48px rgba(0,0,0,0.15)",
              animation: "modal-scale-in 0.25s ease",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 12 }}>
              {confirmState.title}
            </div>
            <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6, marginBottom: 28 }}>
              {confirmState.message}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => handleConfirm(false)}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  padding: "10px 24px",
                  borderRadius: 10,
                  fontWeight: 700,
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: 14,
                  transition: "0.15s",
                }}
              >
                キャンセル
              </button>
              <button
                onClick={() => handleConfirm(true)}
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: 10,
                  fontWeight: 700,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                  boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
                  transition: "0.15s",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes toast-enter {
          from { opacity: 0; transform: translateX(40px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toast-exit {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to { opacity: 0; transform: translateX(40px) scale(0.95); }
        }
        @keyframes modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-scale-in {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
