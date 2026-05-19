// lib/manualThumbnail.ts
//
// マニュアルの embedUrl から表示用サムネイル画像 URL を導出する。
// 公開設定 (リンクを知っている全員が閲覧可能) の Google Drive ファイルや
// YouTube 動画なら、Google / YouTube が提供するサムネイルが利用できる。

/**
 * embedUrl からサムネイル画像 URL を導出
 * 対応できない URL は null を返す (呼び出し側で代替アイコンを表示)
 */
export function getManualThumbnail(embedUrl?: string | null): string | null {
  if (!embedUrl) return null;
  const u = embedUrl.trim();
  if (!u) return null;

  // YouTube → 公式サムネイル
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt?.[1]) {
    // hqdefault は 480x360 で常に存在する安定サイズ
    return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  }

  // Google Drive ファイル全般 (Docs / Slides / Sheets / PDF / 画像 など)
  // https://drive.google.com/thumbnail?id=FILE_ID&sz=wXXX
  // 公開リンクのファイルなら認証不要で取得可能
  const drive = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive?.[1]) {
    return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w400`;
  }

  // Google Docs / Slides / Sheets
  const gdocs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (gdocs?.[2]) {
    return `https://drive.google.com/thumbnail?id=${gdocs[2]}&sz=w400`;
  }

  // Canva は公開サムネイル API なし → 諦める
  return null;
}

/**
 * マニュアル配列から「先頭の使えるサムネイル」を返す。
 * シリーズの代表画像を自動選定するときに利用。
 */
export function pickSeriesThumbnail<T extends { embedUrl?: string | null }>(
  manuals: T[]
): string | null {
  for (const m of manuals) {
    const t = getManualThumbnail(m.embedUrl ?? undefined);
    if (t) return t;
  }
  return null;
}
