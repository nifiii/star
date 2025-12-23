import { GoogleGenAI } from "@google/genai";

type LogType = 'info' | 'success' | 'error';
type Logger = (message: string, type?: LogType) => void;

// --- Global Fetch Interceptor Setup ---
// The SDK might not support 'baseUrl' in all versions/configurations.
// We patch window.fetch to ensure requests to Google's API are redirected 
// to our local Nginx proxy (/google-ai), which handles the VPN/Connection.
const setupProxyInterceptor = () => {
    if ((window as any)._geminiProxyInstalled) return;

    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let urlStr = typeof input === 'string' ? input : input.toString();
        
        // Target Domain to intercept
        const targetDomain = 'generativelanguage.googleapis.com';
        
        if (urlStr.includes(targetDomain)) {
            // Replace the Google domain with our local proxy path
            // e.g. https://generativelanguage.googleapis.com/v1beta/... 
            // becomes /google-ai/v1beta/...
            // Nginx will then strip /google-ai/ and forward to Google.
            const proxyBase = `${window.location.origin}/google-ai`;
            const newUrl = urlStr.replace(`https://${targetDomain}`, proxyBase);
            
            // console.debug(`[Proxy] Redirecting: ${urlStr} -> ${newUrl}`);
            return originalFetch(newUrl, init);
        }
        
        return originalFetch(input, init);
    };
    (window as any)._geminiProxyInstalled = true;
};

export const analyzeData = async (
  data: any[], 
  customPrompt?: string,
  onLog?: Logger
): Promise<string> => {
  // Ensure proxy is active before making any calls
  setupProxyInterceptor();

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
    // 初始化 SDK
    // 由于我们已经 patch 了 window.fetch，这里不需要 (也可能不支持) 传递 baseUrl
    // SDK 会尝试连接 generativelanguage.googleapis.com，然后被拦截器重定向到 /google-ai
    const ai = new GoogleGenAI({ 
      apiKey: apiKey
    });
    
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
    // 使用用户验证过的模型 (Gemini 3 Flash Preview)
    const modelId = 'gemini-3-flash-preview';

    log(`🧠 调用模型: ${modelId} (Via Nginx Proxy)`, 'info');
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
         log("💡 提示: 网络连接失败。请检查 Nginx 代理是否正常运行。", 'error');
    }

    return `分析失败。\n错误信息: ${error.message}`;
  }
};