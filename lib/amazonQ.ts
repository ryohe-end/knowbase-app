export async function askAmazonQ(prompt: string, userId = "anonymous") {
  // 環境変数名を統一
  const appId = process.env.QBUSINESS_APP_ID;
  const region = process.env.AWS_REGION || "us-east-1";
  
  if (!appId) throw new Error("Missing env: QBUSINESS_APP_ID");

  const endpoint = `https://qbusiness-runtime.${region}.amazonaws.com/applications/${appId}/chat`;

  const body = {
    userId,
    messages: [
      {
        role: "user",
        content: [{ text: prompt }],
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-User-Agent": "aws-sdk-js/3.0.0",
      Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(await res.text());
    throw new Error("Amazon Q API error");
  }

  const data = await res.json();
  const answer =
    data.output?.message?.content
      ?.map((c: any) => c.text)
      .join("\n") ?? "回答が取得できませんでした。";

  return answer;
}