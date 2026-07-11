// lib/useRefundGuard.ts
// 返金ページの直URLアクセス保護。/me の可否を取得し、権限が無ければ
// 返金トップへリダイレクトする。返り値: null=判定中 / true=許可 / false=不許可(遷移中)。
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RefundCap = "canApply" | "canApprove" | "canFinance";

export function useRefundGuard(cap: RefundCap): boolean | null {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/store-settings/refund-payment/me", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setAllowed(false);
            router.replace("/store-settings/refund-payment");
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data?.[cap]) {
          setAllowed(true);
        } else {
          setAllowed(false);
          router.replace("/store-settings/refund-payment");
        }
      } catch {
        if (!cancelled) {
          setAllowed(false);
          router.replace("/store-settings/refund-payment");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cap, router]);

  return allowed;
}
