import { GoogleGenAI } from "@google/genai";

export const analyzeData = async (data: any[], customPrompt?: string): Promise<string> => {
  if (!process.env.API_KEY) {
    return "错误: 未检测到 API_KEY 环境变量。请确保在运行环境中配置了 Google Gemini API Key。";
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Prepare data summary to avoid token limits if list is huge
    // 50 items is usually enough for a statistical sample
    const dataSample = data.length > 50 ? data.slice(0, 50) : data;
    const jsonStr = JSON.stringify(dataSample);

    const defaultPrompt = `
      Analyze the following badminton match data (JSON format).
      Provide insights on:
      1. Key performers or leaders.
      2. Interesting patterns in scores or rankings.
      3. Overall competitiveness of the group.
      
      Format the output in Chinese (Markdown).
    `;

    const prompt = customPrompt || defaultPrompt;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Data: ${jsonStr}\n\nTask: ${prompt}`,
      config: {
        systemInstruction: "你是一位专业的青少年羽毛球赛事数据分析师。请用中文简练地提供数据洞察。",
      }
    });

    return response.text || "未生成分析结果。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "分析失败。请检查 API Key 或网络连接 (可能需要代理)。";
  }
};