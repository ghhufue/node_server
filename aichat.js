const fetch = require("node-fetch");

/**
 * 向 AI 模型发送请求并获取回复
 * @param {string} modelId 模型 ID
 * @param {Array} messages 消息列表，每条消息为 {role: "user" | "assistant", content: string}
 * @param {string} apiKey API 密钥
 * @param {string} baseUrl API 基础 URL
 */
async function getAIResponse(modelId, messages, apiKey, baseUrl, userId) {
  const endpoint = `${baseUrl}/chat/completions`;
  console.log(endpoint);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const payload = {
    model: modelId,
    messages: transformMessages(messages, userId),
    stream: false,
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${response.statusText}`);
    }
    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error("Error:", error.message);
  }
}

function transformMessages(historyMessages, userId) {
  const sortedMessages = historyMessages.sort((a, b) => a.id - b.id);
  const transformedMessages = sortedMessages.map((message) => {
    return {
      role: message.sender_id === userId ? "user" : "assistant",
      content: message.content,
    };
  });
  return transformedMessages;
}

module.exports = { getAIResponse };
