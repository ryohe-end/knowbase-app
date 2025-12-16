// app/api/dev-skip/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
    console.log("--- [DEV-SKIP] 1. API処理開始 ---"); // ★ 追加ログ

    const ADMIN_EMAIL_FALLBACK = "admin@example.com";
    const maxAge = 60 * 60 * 24 * 7; 
    
    const cookieStore = cookies(); 

    // Cookie設定
    cookieStore.set("kb_user", ADMIN_EMAIL_FALLBACK, {
        httpOnly: true,
        secure: true,
        path: "/",
        maxAge: maxAge,
    });
    
    cookieStore.set("kb_admin", "1", {
        httpOnly: true,
        secure: true,
        path: "/",
        maxAge: maxAge,
    });
    
    console.log("--- [DEV-SKIP] 2. Cookie設定完了 ---"); // ★ 追加ログ

    // サーバー側で直接リダイレクトを返す
    const url = new URL("/", req.url);
    
    // Cookieをヘッダーに含めた状態でリダイレクト
    const response = NextResponse.redirect(url, { status: 307 });
    
    console.log("--- [DEV-SKIP] 3. リダイレクト応答返却 ---"); // ★ 追加ログ
    return response;
}