import { GoogleGenAI } from "@google/genai";

type LogType = 'info' | 'success' | 'error';
type Logger = (message: string, type?: LogType) => void;

export const analyzeData = async (
  data: any[], 
  customPrompt?: string,
  onLog?: Logger
): Promise<string> => {
  // Helper to trigger log callback if provided
  const log = (msg: string, type: LogType = 'info') => {
    if (onLog) onLog(msg, type);
  };

  const apiKey = process.env.API_KEY;

  log("🤖 正在初始化 Gemini AI 请求...", 'info');
  
  if (!apiKey) {
    log("❌ 严重错误: 未配置 API_KEY 环境变量。", 'error');
    return "错误: 未检测到 API_KEY 环境变量。请确保在运行环境中配置了 Google Gemini API Key。";
  }

  // Safe logging of API Key
  const maskedKey = apiKey.length > 8 
    ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}` 
    : "(长度无效)";
  log(`🔑 API Key 状态: 已加载 (${maskedKey})`, 'info');

  try {
    // 使用 Nginx 代理路径初始化 SDK
    // 这样前端浏览器会请求: https://<your-domain>/google-ai/v1beta/...
    // 而不是直接连接 generativelanguage.googleapis.com (可能被墙)
    const ai = new GoogleGenAI({ 
      apiKey: apiKey,
      baseUrl: `${window.location.origin}/google-ai`
    } as any);
    
    // Prepare data summary to avoid token limits if list is huge
    // 50 items is usually enough for a statistical sample
    const dataSample = data.length > 50 ? data.slice(0, 50) : data;
    const jsonStr = JSON.stringify(dataSample);

    log(`📦 数据负载: 共 ${data.length} 条数据，发送前 ${dataSample.length} 条用于分析。`, 'info');
    log(`📏 Payload 大小: 约 ${jsonStr.length} 字符`, 'info');

    const defaultPrompt = `
      Analyze the following badminton match data (JSON format).
      Provide insights on:
      1. Key performers or leaders.
      2. Interesting patterns in scores or rankings.
      3. Overall competitiveness of the group.
      
      Format the output in Chinese (Markdown).
    `;

    const prompt = customPrompt || defaultPrompt;
    const modelId = 'gemini-3-flash-preview';

    log(`🧠 调用模型: ${modelId} (Via Proxy)`, 'info');
    log(`⏳ 请求已发送，等待响应...`, 'info');

    const startTime = Date.now();
    const response = await ai.models.generateContent({
      model: modelId,
      contents: `Data: ${jsonStr}\n\nTask: ${prompt}`,
      config: {
        systemInstruction: "你是一位专业的青少年羽毛球赛事数据分析师。请用中文简练地提供数据洞察。",
      }
    });
    const duration = Date.now() - startTime;

    if (!response || !response.text) {
        log(`⚠️ 响应内容为空或格式异常。`, 'error');
        // log raw response object is not possible via string-only logger, but we can log keys
        log(`Response Keys: ${Object.keys(response || {}).join(', ')}`, 'error');
    } else {
        log(`✅ 分析成功! (耗时: ${duration}ms)`, 'success');
    }
    
    return response.text || "未生成分析结果 (Empty Response)。";

  } catch (error: any) {
    log(`❌ Gemini API 请求失败:`, 'error');
    
    if (error instanceof Error) {
        log(`Type: ${error.name}`, 'error');
        log(`Message: ${error.message}`, 'error');
    } else {
        log(`Unknown error: ${JSON.stringify(error)}`, 'error');
    }

    // Check for common fetch errors or API specific errors
    if (error.message?.includes('401') || error.message?.includes('403')) {
        log("💡 提示: 权限被拒绝，请检查 API Key 是否有效。", 'error');
    }
    if (error.message?.includes('Failed to fetch')) {
         log("💡 提示: 网络错误。可能需要检查 Nginx 代理配置。", 'error');
    }

    return `分析失败。\n错误信息: ${error.message}`;
  }
};