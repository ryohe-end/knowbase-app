// lib/sendGuards.ts
// Push/DM 送信前のガード。
//  (1) NGワード: 件名/本文に不適切語が含まれていたら送信を拒否する。
//  (2) 送信時間帯: 会員への配信は 8:00〜21:00(JST) のみ許可 (夜間の配信を防ぐ)。
// いずれもサーバ側(route)で最終判定する。フロントの表示崩れ等では回避できない。

// 既定のNGワード。運用に合わせて編集可。環境変数 NG_WORDS (カンマ区切り) で追加もできる。
const DEFAULT_NG_WORDS = [
  "死ね", "殺す", "ぶっ殺", "殺してやる",
  "きもい", "キモい", "気持ち悪い",
  "うざい", "ウザい",
  "ブス", "デブ", "ブサイク",
  "ばか", "バカ", "アホ", "カス", "クズ",
  "詐欺", "ぼったくり",
];

// 送信を許可する時間帯 (JST, [start, end) の時)。end 以降・start 未満は不可。
export const SEND_WINDOW_START_HOUR = 8;  // 8:00 から
export const SEND_WINDOW_END_HOUR = 21;   // 21:00 より前まで (21時以降は不可)

function loadNgWords(): string[] {
  const extra = (process.env.NG_WORDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_NG_WORDS, ...extra];
}

// text に含まれるNGワードを返す (無ければ空配列)。全角/半角の簡易正規化のみ。
export function findNgWords(text: string): string[] {
  const t = (text || "").normalize("NFKC");
  const hits: string[] = [];
  for (const w of loadNgWords()) {
    if (w && t.includes(w) && !hits.includes(w)) hits.push(w);
  }
  return hits;
}

// Date の JST での「時」(0-23)
export function jstHour(d: Date): number {
  return new Date(d.getTime() + 9 * 3600 * 1000).getUTCHours();
}

// 送信時刻が許可時間帯内か判定する。
export function checkSendWindow(when: Date): { ok: boolean; hour: number } {
  const hour = jstHour(when);
  const ok = hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
  return { ok, hour };
}

// 'YYYY-MM-DD HH:mm' (JST) 文字列 → Date。immediate/未指定は現在時刻。
export function resolveSendTime(opts: { isImmediate?: boolean; scheduledAt?: string }): Date {
  if (opts.isImmediate || !opts.scheduledAt) return new Date();
  const ms = Date.parse(opts.scheduledAt.replace(" ", "T") + "+09:00");
  return Number.isFinite(ms) ? new Date(ms) : new Date();
}

// route から呼ぶ統合チェック。draft(下書き)は時間帯チェックを免除する。
// 返り値 error があればそのまま 400 で返せる文言。
export function checkSendGuards(input: {
  subject: string;
  body: string;
  isDraft?: boolean;
  isImmediate?: boolean;
  scheduledAt?: string;
}): { ok: true } | { ok: false; error: string } {
  const ng = findNgWords(`${input.subject}\n${input.body}`);
  if (ng.length > 0) {
    return { ok: false, error: `NGワードが含まれています: ${ng.join("、")}` };
  }
  if (!input.isDraft) {
    const when = resolveSendTime(input);
    const w = checkSendWindow(when);
    if (!w.ok) {
      return {
        ok: false,
        error: `配信可能時間は ${SEND_WINDOW_START_HOUR}:00〜${SEND_WINDOW_END_HOUR}:00 です（指定時刻: ${w.hour}時台）。時間内に予約してください。`,
      };
    }
  }
  return { ok: true };
}
