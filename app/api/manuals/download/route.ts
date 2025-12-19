// app/api/manuals/download/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  // OSでヤバい文字をざっくり除去
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
}

function guessExtFromType(ct: string) {
  const t = ct.toLowerCase();
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("msword")) return ".doc";
  if (t.includes("officedocument.wordprocessingml")) return ".docx";
  if (t.includes("officedocument.spreadsheetml")) return ".xlsx";
  if (t.includes("officedocument.presentationml")) return ".pptx";
  if (t.includes("powerpoint")) return ".ppt";
  if (t.includes("zip")) return ".zip";
  if (t.includes("mp4")) return ".mp4";
  if (t.includes("mpeg")) return ".mpg";
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg")) return ".jpg";
  return "";
}

async function fetchDriveWithConfirm(fileId: string) {
  // まずは通常の uc で試す（googleusercontent / drive.google.com どちらでもOK）
  const base = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

  const first = await fetch(base, {
    redirect: "follow",
    headers: {
      // 一部環境でHTMLにされにくくする程度の保険
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
    },
  });

  const ct1 = first.headers.get("content-type") || "";
  if (first.ok && !ct1.includes("text/html")) {
    return { res: first, contentType: ct1 };
  }

  // HTMLが返った → confirm が必要な警告ページ or 権限/ログイン
  const html = await first.text();

  // confirm=XXXX をHTMLから拾う（警告ページのパターン）
  const m = html.match(/confirm=([0-9A-Za-z-_]+)/);
  if (!m) {
    // confirm が取れない = 共有権限NG/ログイン要求の可能性が高い
    throw new Error(
      "Google Drive Error: ファイルが「リンクを知っている全員が閲覧可」になっていないか、警告ページの確認トークンが取得できませんでした。"
    );
  }

  const confirm = m[1];
  const secondUrl = `${base}&confirm=${encodeURIComponent(confirm)}`;

  const second = await fetch(secondUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
      // 1回目のcookieを引き継げない環境でも動くことが多いが、
      // それでもダメなら Drive API 方式に寄せる必要あり。
    },
  });

  const ct2 = second.headers.get("content-type") || "";
  if (!second.ok || ct2.includes("text/html")) {
    throw new Error(
      "Google Drive Error: ダウンロード取得に失敗しました（共有設定/制限/ファイル形式の可能性）。"
    );
  }

  return { res: second, contentType: ct2 };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("fileId");
  const fileUrl = searchParams.get("url");
  const rawName = searchParams.get("name") || "download";

  try {
    let arrayBuffer: ArrayBuffer;
    let contentType = "application/octet-stream";

    if (fileId) {
      const { res, contentType: ct } = await fetchDriveWithConfirm(fileId);
      contentType = ct || contentType;
      arrayBuffer = await res.arrayBuffer();
    } else if (fileUrl) {
      const res = await fetch(fileUrl, { redirect: "follow" });
      const ct = res.headers.get("content-type") || "";
      if (!res.ok || ct.includes("text/html")) {
        return new NextResponse("External Link Error", { status: 403 });
      }
      contentType = ct || contentType;
      arrayBuffer = await res.arrayBuffer();
    } else {
      return new NextResponse("No ID or URL provided", { status: 400 });
    }

    const filenameBase = safeFilename(rawName);
    const ext = guessExtFromType(contentType);
    const filename = filenameBase.endsWith(ext) ? filenameBase : `${filenameBase}${ext}`;

    // NextResponse は Uint8Array で渡すと安定
    const body = new Uint8Array(arrayBuffer);

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Download failed", { status: 500 });
  }
}
