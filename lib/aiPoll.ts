// lib/aiPoll.ts (client)
// AI分析の非同期実行をUIから使うヘルパー。
// 初回GETで jobId + チャートデータ(高速)を受け取り(onInitialで反映)、?poll= でポーリングして本文を取得する。
export async function runAiAnalysis(
  url: string,
  onInitial?: (d: any) => void
): Promise<{ analysis?: string; error?: string }> {
  try {
    const res = await fetch(url);
    const d = await res.json();
    if (!res.ok || !d.ok) return { error: d?.error || "AI分析の生成に失敗しました" };
    onInitial?.(d);
    if (d.analysis) return { analysis: d.analysis }; // 同期フォールバック
    if (!d.jobId) return { error: "AI分析の生成に失敗しました" };
    const pollUrl = `${url}${url.includes("?") ? "&" : "?"}poll=${d.jobId}`;
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pr = await fetch(pollUrl);
      const pd = await pr.json();
      if (pd.status === "done") return { analysis: pd.analysis };
      if (pd.status === "error") return { error: pd.error || "AI分析の生成に失敗しました" };
    }
    return { error: "AI分析がタイムアウトしました。もう一度お試しください。" };
  } catch {
    return { error: "AI分析の生成に失敗しました" };
  }
}
