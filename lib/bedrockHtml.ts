// lib/bedrockHtml.ts
// Claude on Amazon Bedrock で「おしゃれな HTML」を生成する共通ヘルパー。
// DM メール(email)と アプリ内お知らせ欄(notice)で system プロンプトだけ切り替える。
// 既存の @aws-sdk/client-bedrock-runtime を使い、新規APIキーは不要(AWS認証を利用)。
// ※ Amplify SSR ロールに bedrock:InvokeModel 権限が必要(無いと 403、UIに出ない)。
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-8";

const bedrock = new BedrockRuntimeClient({ region: REGION });

export type HtmlKind = "email" | "notice";

export function brandLabel(brand?: string): { name: string; color: string } {
  return (brand || "").toUpperCase().startsWith("JOYFIT")
    ? { name: "JOYFIT", color: "#1F2C5C" }
    : { name: "FIT365", color: "#E26E9D" };
}

const SYSTEMS: Record<HtmlKind, string> = {
  email: `あなたはフィットネスクラブの会員向け HTML メールを作るデザイナー兼コーダーです。
制約:
- 出力は「1通の完結した HTML メール」のみ。説明・前置き・コードフェンス(\`\`\`)は付けない。
- メールクライアント互換のため table レイアウト + インライン CSS のみ。外部CSS/JS/webフォント/<script>は禁止。
- 幅は最大600pxのセンタリング。スマホでも崩れないよう max-width:100%。画像は指定URLのみ(無ければ画像なし)。
- ブランドカラーをアクセントに、清潔で今風のデザイン。日本語。誇大・不当表示は避ける。`,
  notice: `あなたはフィットネスクラブ会員アプリの「お知らせ」欄に表示する HTML を作るデザイナー兼コーダーです。
制約:
- 出力は「お知らせ本文の HTML 断片」のみ。説明・前置き・コードフェンス(\`\`\`)や <html>/<head>/<body> タグは付けない。
- モバイルの WebView 表示。モダンでカード風、余白広め、読みやすい。インライン CSS のみ、<script>禁止、外部CSS/webフォント禁止。
- 幅は max-width:100% で親要素にフィット。画像は指定URLのみ(無ければ画像なし)。
- ブランドカラーを見出しやボタンのアクセントに。日本語。誇大・不当表示は避ける。`,
};

// お知らせ/通知の「タイトル」と「本文」プレーンテキストを生成する。
// HTMLではなく、そのまま title/body 入力欄へ反映して使う。
export async function generateText(
  input: { prompt?: string; subject?: string; body?: string; brand?: string }
): Promise<{ ok: true; title: string; body: string } | { ok: false; error: string; status: number }> {
  const prompt = (input.prompt || "").trim();
  if (!prompt && !input.body && !input.subject) {
    return { ok: false, error: "prompt is required", status: 400 };
  }
  const brand = brandLabel(input.brand);
  const system = `あなたはフィットネスクラブ「${brand.name}」の会員向けPUSH通知・お知らせ文を書く日本語コピーライターです。
制約:
- 出力は必ず JSON オブジェクト1個のみ。前置き・説明・コードフェンス(\`\`\`)は付けない。
- 形式: {"title": "…", "body": "…"}
- title は通知バナーに出る短い見出し(全角30文字以内目安、絵文字は控えめ)。
- body は本文。丁寧で読みやすく、誇大・不当表示は避ける。改行は \\n。過度に長くしない(目安200文字以内)。`;
  const userText = [
    input.subject ? `現在のタイトル: ${input.subject}` : "",
    input.body ? `現在の本文(下書き):\n${input.body}` : "",
    prompt ? `作成指示: ${prompt}` : "",
    "",
    "上記を踏まえ、タイトルと本文を JSON で生成してください。JSONのみ出力。",
  ].filter(Boolean).join("\n");

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  };

  try {
    const res = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      })
    );
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: Array<{ type: string; text?: string }>;
    };
    let text = (decoded.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("")
      .trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    // JSON 抽出 (前後にノイズが混ざっても最初の { … } を拾う)
    const m = text.match(/\{[\s\S]*\}/);
    let parsed: { title?: string; body?: string } = {};
    try {
      parsed = JSON.parse(m ? m[0] : text);
    } catch {
      return { ok: false, error: "生成結果を解釈できませんでした。もう一度お試しください。", status: 502 };
    }
    const title = String(parsed.title ?? "").trim();
    const body = String(parsed.body ?? "").trim();
    if (!title && !body) return { ok: false, error: "empty_generation", status: 502 };
    return { ok: true, title, body };
  } catch (e: any) {
    console.error("[bedrockText] error:", e?.name, e?.message);
    const error =
      e?.name === "AccessDeniedException"
        ? "Bedrock へのアクセス権限がありません（bedrock:InvokeModel / モデルアクセス設定を確認）"
        : e?.name === "ValidationException"
        ? (/not allowed/i.test(String(e?.message || ""))
            ? "Bedrock でこのモデルが未有効化です（AWS Bedrock → モデルアクセスを有効化、または SCP/組織ポリシーのブロックを確認）"
            : "Bedrock のモデルID/リージョン設定を確認してください")
        : "AI生成に失敗しました";
    return { ok: false, error, status: 502 };
  }
}

export async function generateHtml(
  kind: HtmlKind,
  input: { prompt?: string; subject?: string; body?: string; imageUrl?: string; brand?: string }
): Promise<{ ok: true; html: string } | { ok: false; error: string; status: number }> {
  const prompt = (input.prompt || "").trim();
  if (!prompt && !input.body) {
    return { ok: false, error: "prompt or body is required", status: 400 };
  }
  const brand = brandLabel(input.brand);
  const label = kind === "email" ? "件名" : "タイトル";
  const userText = [
    `ブランド: ${brand.name}（アクセントカラー ${brand.color}）`,
    input.subject ? `${label}: ${input.subject}` : "",
    input.imageUrl ? `使用可能な画像URL: ${input.imageUrl}` : "画像は使わない",
    prompt ? `作成指示: ${prompt}` : "",
    input.body ? `下書き本文(この内容をHTML化・装飾):\n${input.body}` : "",
    "",
    kind === "email"
      ? "上記をもとに、おしゃれで読みやすい HTML メール本文を生成してください。HTMLのみ出力。"
      : "上記をもとに、おしゃれで読みやすい お知らせ本文の HTML を生成してください。HTMLのみ出力。",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: SYSTEMS[kind],
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  };

  try {
    const res = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      })
    );
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: Array<{ type: string; text?: string }>;
    };
    let html = (decoded.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("")
      .trim();
    html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (!html) return { ok: false, error: "empty_generation", status: 502 };
    return { ok: true, html };
  } catch (e: any) {
    console.error("[bedrockHtml] error:", e?.name, e?.message);
    const error =
      e?.name === "AccessDeniedException"
        ? "Bedrock へのアクセス権限がありません（bedrock:InvokeModel / モデルアクセス設定を確認）"
        : e?.name === "ValidationException"
        ? (/not allowed/i.test(String(e?.message || ""))
            ? "Bedrock でこのモデルが未有効化です（AWS Bedrock → モデルアクセスを有効化、または SCP/組織ポリシーのブロックを確認）"
            : "Bedrock のモデルID/リージョン設定を確認してください")
        : "AI生成に失敗しました";
    return { ok: false, error, status: 502 };
  }
}
