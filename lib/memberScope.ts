// lib/memberScope.ts
//
// 配信(Push/お知らせ)の宛先スコープ判定を「Oracle 会員契約クラブコード」で行うためのヘルパ。
//
// なぜ app_user.club_code / member_id 先頭 を使わないか:
//   - app_user.club_code は「アプリ登録クラブ」で契約クラブ(所属店舗)と異なることが多い
//     (相互利用/別クラブでアプリ登録)。→ 自店会員が「担当外」と誤判定される。
//   - member_id 先頭は「発行クラブ」で、転籍すると member_id は据え置きのまま契約クラブが変わる。
//     → 転籍済み会員を誤って担当内/担当外と判定する。
//   会員抽出(members/extract)は Oracle の会員契約.クラブコードで会員を絞っている。宛先の
//   再検証も同じ Oracle 契約クラブで行い、抽出と整合させる。
//
// 実装: member-search(Oracle) の member_extract を、対象クラブに「契約している」アプリ会員
//   (deliveryType=push, 条件なし)で叩き、会員番号集合を得る。単一〜少数店舗のみ対象なので
//   全店横断にはならない。短期キャッシュで送信のたびの往復を抑える。
import { callMemberSearch } from "@/lib/unpaid";

const TTL_MS = 5 * 60 * 1000; // 5分キャッシュ
const PAGE = 5000; // member_extract の1ページ上限
const MAX_ROWS = 50000; // 安全上限 (これを超える単発検証は行わない)

const cache = new Map<string, { at: number; set: Set<string> }>();

// 条件なしの空グループ (mapGroup の出力形に合わせる。全会員 = 絞り込みなし)。
const EMPTY_GROUP = {
  genderCodes: [] as number[],
  membershipStatus: [] as string[],
  contractTypes: [] as string[],
  contractForms: [] as string[],
  hasUnpaidOnly: false,
};

// 指定クラブ群に「契約している」アプリ会員(push可否問わず)の会員番号集合(Oracle 契約クラブ)。
// clubCodes は呼び出し側で担当スコープ内に絞ってから渡すこと(空なら空集合)。
export async function oracleAppMembersInClubs(clubCodes: string[]): Promise<Set<string>> {
  const codes = [...new Set(clubCodes.map((c) => String(c).trim()).filter(Boolean))].sort();
  if (codes.length === 0) return new Set();
  const key = codes.join(",");

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.set;

  const set = new Set<string>();
  let offset = 0;
  for (;;) {
    const searchBody = {
      deliveryType: "push",
      clubCodes: codes,
      includeOptions: true, // 会員区分90も含め、正規会員を落とさない(誤「担当外」を避ける)
      groupOp: "OR",
      groups: [EMPTY_GROUP], // 条件なし = 当該クラブの全アプリ会員
      limit: PAGE,
      offset,
    };
    const payload = Buffer.from(JSON.stringify(searchBody), "utf-8").toString("base64");
    const data = await callMemberSearch({ type: "member_extract", payload });
    const rows: any[] = Array.isArray(data?.results) ? data.results : [];
    for (const r of rows) set.add(String(r.memberNo));
    offset += rows.length;
    if (rows.length < PAGE || offset >= MAX_ROWS) break;
  }

  cache.set(key, { at: Date.now(), set });
  return set;
}
