"use client";

type Props = {
  text?: string;
  visible?: boolean;
};

export default function AdminLoadingOverlay({
  text = "KnowBase 管理画面を読み込み中...",
  visible = true,
}: Props) {
  if (!visible) return null;

  return (
    <div
      className="kb-loading-full-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999999,
        textAlign: "center",
        minHeight: "100vh",
      }}
      role="alert"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="kb-loading-main-box"
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div
          className="kb-logo-spin-container"
          style={{ position: "relative", width: 80, height: 80, marginBottom: 24 }}
        >
          <img
            src="https://houjin-manual.s3.us-east-2.amazonaws.com/KnowBase_icon.png"
            alt="Loading Logo"
            className="kb-spin-logo"
            style={{
              width: 40,
              height: 40,
              position: "absolute",
              top: 20,
              left: 20,
              zIndex: 2,
            }}
          />
          <div className="kb-outer-ring" />
        </div>

        <div
          className="kb-loading-bar-container"
          style={{
            width: 160,
            height: 4,
            background: "#f1f5f9",
            borderRadius: 10,
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <div className="kb-loading-bar-fill" />
        </div>

        <p
          className="kb-loading-status"
          style={{ fontSize: 13, color: "#64748b", fontWeight: 600, margin: 0 }}
        >
          {text}
        </p>
      </div>

      <style jsx>{`
        .kb-outer-ring {
          width: 80px;
          height: 80px;
          border: 3px solid #f1f5f9;
          border-top: 3px solid #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        .kb-loading-bar-fill {
          width: 50%;
          height: 100%;
          background: #3b82f6;
          border-radius: 10px;
          animation: progress 1.5s ease-in-out infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes progress {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(200%);
          }
        }
        /* ✅ saving中は操作させないのが安全 */
        .kb-loading-full-overlay {
          pointer-events: all;
        }
      `}</style>
    </div>
  );
}
