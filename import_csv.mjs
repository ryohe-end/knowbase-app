import fs from 'fs';

const API_URL = "http://localhost:3000/api/users";
const CSV_FILE = "./メールリスト.csv";

async function main() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`❌ エラー: ${CSV_FILE} が見つかりません。`);
    return;
  }

  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== "");
  
  const users = lines.slice(1).map(line => {
    // 引用符内のカンマを考慮した分割
    const matches = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=^)(?=,))/g);
    if (!matches) return null;
    const data = matches.map(m => m.replace(/^"|"$/g, '').replace(/""/g, '"'));
    
    // JSONパースを安全に行う補助関数
    const safeParse = (str) => {
      if (!str || str.trim() === "") return [];
      try {
        return JSON.parse(str);
      } catch (e) {
        return [];
      }
    };

    return {
      userId: data[0],
      name: data[1],
      email: data[2],
      role: data[3],
      brandIds: safeParse(data[4]),
      deptIds: safeParse(data[5]),
      groupIds: safeParse(data[6])
    };
  }).filter(u => u !== null);

  console.log(`${users.length} 名のテスト登録を開始します...`);

  for (const user of users) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "create",
          user: { ...user, isActive: true },
          includePassword: true 
        }),
      });

      if (res.ok) {
        console.log(`✅ 成功: ${user.userId} (${user.name})`);
      } else {
        const err = await res.json();
        console.error(`❌ 失敗: ${user.userId} - ${err.error}`);
      }
    } catch (e) {
      console.error(`⚠️ 通信エラー: ${user.userId}`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

main();
