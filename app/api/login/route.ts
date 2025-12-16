// app/api/login/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

// ====================================================================
// ★ 重要: パスワード検証のモック関数 (app/api/users/route.ts と完全に一致している必要があります)
// 実際の環境では、'await bcrypt.compare(password, hash)' を使用してください。
// ====================================================================
const mockCompare = (password: string, hash: string): boolean => {
    // 【MOCKロジック】: ハッシュが 'hashed_' + パスワード と一致する場合に認証成功
    const result = hash === `hashed_${password}`; 
    console.log(`[AUTH-LOG] Mock Compare Check: Input Pass='${password}', DB Hash='${hash}'. Result: ${result}`);
    return result;
};
// ====================================================================

// DynamoDBのユーザー型定義
type KbUser = {
  user_id: string; // PK
  name: string;
  email: string; // GSIのPK
  role: "admin" | "editor" | "viewer";
  isActive?: boolean;
  passwordHash?: string;
};

// ハードコードされたフォールバック管理者情報
const ADMIN_EMAIL_FALLBACK = "admin@example.com";
const ADMIN_PASS_FALLBACK = "admin123";

// DynamoDBテーブル名とGSI名
const TABLE_USERS = "yamauchi-Users";
const EMAIL_GSI_NAME = "email-index"; 

// AWSクライアント設定
const region = process.env.AWS_REGION || "us-east-1";
const ddbClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(ddbClient);


/**
 * ユーザーの認証情報を検証し、DBからユーザー情報を取得する
 */
async function authenticateUser(email: string, isExternalLogin: boolean, pass?: string): Promise<KbUser | null> {
    console.log(`[AUTH-LOG] Starting authentication for: ${email}. External: ${isExternalLogin}`);

    // 1. ハードコードされた管理者認証 (フォールバック)
    if (!isExternalLogin && email === ADMIN_EMAIL_FALLBACK && pass === ADMIN_PASS_FALLBACK) {
        console.log(`[AUTH-LOG] Success: Fallback Admin logged in.`);
        return { 
            user_id: "ADMIN_FALLBACK", 
            email: ADMIN_EMAIL_FALLBACK, 
            name: "Fallback Admin", 
            role: "admin", 
            isActive: true 
        };
    }
    
    // 2. DynamoDBによるユーザー認証 (GSI: email-indexを使用)
    try {
        const params = {
            TableName: TABLE_USERS,
            IndexName: EMAIL_GSI_NAME, 
            KeyConditionExpression: "email = :email",
            ExpressionAttributeValues: {
                ":email": email,
            },
            Limit: 1,
        };

        const result = await docClient.send(new QueryCommand(params));
        const user = (result.Items?.[0] as KbUser) || null;
        
        if (!user) {
            console.log(`[AUTH-LOG] Failure: User not found in DB with email: ${email}`);
            return null;
        }

        // ユーザーが非アクティブな場合は拒否
        if (user.isActive === false) {
            console.log(`[AUTH-LOG] Failure: User found but is inactive: ${email}`);
            return null;
        }

        // 2a. 外部ログイン (Google) の場合
        if (isExternalLogin) {
            console.log(`[AUTH-LOG] Success: Google Auth OK for: ${email}`);
            return user; // DBに存在しisActiveであれば認証成功
        }
        
        // 2b. パスワードログインの場合
        if (pass && user.passwordHash) {
            // パスワードが提供されており、DBにハッシュが保存されている場合

            if (mockCompare(pass, user.passwordHash)) { 
                console.log(`[AUTH-LOG] Success: Password Auth OK for: ${email}`);
                return user;
            } else {
                console.log(`[AUTH-LOG] Failure: Password mismatch for: ${email}`);
                return null;
            }
        }
        
        // パスワード認証を試みたが、DBにハッシュがない
        if (pass && !user.passwordHash) {
             console.log(`[AUTH-LOG] Failure: Password provided, but DB is missing passwordHash for: ${email}`);
        }

        // その他、上記の認証がすべて失敗した場合
        return null;

    } catch (error) {
        console.error("[AUTH-LOG] CRITICAL: DynamoDB Query Failed! Check credentials/region/table name.", error);
        return null; 
    }
}


export async function POST(req: Request) {
    const { email, pass } = await req.json();
    const isExternalLogin = !pass;
    
    if (!email) {
        return NextResponse.json({ ok: false, error: "メールアドレスは必須です" }, { status: 400 });
    }

    // ユーザーを認証
    const authenticatedUser = await authenticateUser(email, isExternalLogin, pass);

    if (!authenticatedUser) {
        return NextResponse.json({ 
            ok: false, 
            error: isExternalLogin 
                ? "このメールアドレスのユーザーは登録されていないか、アクティブではありません。" 
                : "メールまたはパスワードが違います" 
        }, { status: 401 });
    }

    // 認証成功: セッションCookieを設定
    const isAdmin = authenticatedUser.role === "admin";
    const maxAge = 60 * 60 * 24 * 7; // 7日

    cookies().set("kb_user", authenticatedUser.email, {
        httpOnly: true,
        secure: true,
        path: "/",
        maxAge: maxAge,
    });
    
    // 管理者権限を持つユーザーにのみkb_adminフラグを設定
    if (isAdmin) {
        cookies().set("kb_admin", "1", {
            httpOnly: true,
            secure: true,
            path: "/",
            maxAge: maxAge,
        });
    } else {
        cookies().delete("kb_admin");
    }

    return NextResponse.json({ 
        ok: true, 
        user: { email: authenticatedUser.email, role: authenticatedUser.role } 
    });
}