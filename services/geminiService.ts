import { GoogleGenAI } from "@google/genai";

type LogType = 'info' | 'success' | 'error';
type Logger = (message: string, type?: LogType) => void;

// --- Global Fetch Interceptor Setup ---
const setupProxyInterceptor = (onLog?: Logger) => {
    if ((window as any)._geminiProxyInstalled) return;

    const originalFetch = window.fetch;
    
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let urlStr: string;
        let originalRequest: Request | null = null;

        // 1. Extract URL string regardless of input type
        if (typeof input === 'string') {
            urlStr = input;
        } else if (input instanceof URL) {
            urlStr = input.toString();
        } else if (input instanceof Request) {
            urlStr = input.url;
            originalRequest = input;
        } else {
            urlStr = String(input);
        }
        
        // Target Domain to intercept
        const targetDomain = 'generativelanguage.googleapis.com';
        
        // 2. Intercept and Rewrite Path
        if (urlStr.includes(targetDomain)) {
            // Use relative path '/google-ai' to avoid origin mismatch issues
            // This transforms "https://generativelanguage.googleapis.com/v1beta/..." 
            // into "/google-ai/v1beta/..."
            // This matches PERFECTLY with the Nginx rule: rewrite ^/google-ai/(.*) /$1 break;
            const proxyBase = '/google-ai';
            const newUrlStr = urlStr.replace(`https://${targetDomain}`, proxyBase);
            
            // Console debug for troubleshooting
            console.log(`[Gemini Proxy] Redirecting: ${urlStr} -> ${newUrlStr}`);

            if (originalRequest) {
                // We must create a new Request to apply the URL change
                // Note: We don't clone() because we want to override the URL.
                const newReq = new Request(newUrlStr, originalRequest);
                return originalFetch(newReq, init);
            }
            
            return originalFetch(newUrlStr, init);
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
  setupProxyInterceptor(onLog);

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

  const maskedKey = apiKey.length > 8 
    ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}` 
    : "(长度无效)";
  log(`🔑 API Key 状态: 已加载 (${maskedKey})`, 'info');

  try {
    const ai = new GoogleGenAI({ 
      apiKey: apiKey
    });
    
    // Limit data size
    const dataSample = data.length > 50 ? data.slice(0, 50) : data;
    const jsonStr = JSON.stringify(dataSample);

    log(`📦 数据负载: 共 ${data.length} 条数据，发送前 ${dataSample.length} 条用于分析。`, 'info');

    const defaultPrompt = `
      Analyze the following badminton match data (JSON format).
      Provide insights on:
      1. Key performers or leaders.
      2. Interesting patterns in scores or rankings.
      3. Overall competitiveness of the group.
      
      Format the output in Chinese (Markdown).
    `;

    const prompt = customPrompt || defaultPrompt;
    
    // [Core Config] Using 'gemini-3-flash-preview' as originally intended.
    // The Nginx 'rewrite' rule will ensure the path is routed correctly.
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
    } else {
        log(`✅ 分析成功! (耗时: ${duration}ms)`, 'success');
    }
    
    return response.text || "未生成分析结果 (Empty Response)。";

  } catch (error: any) {
    log(`❌ Gemini API 请求失败:`, 'error');
    
    let displayMessage = error.message || String(error);

    // --- ENHANCED DEBUGGING ---
    // Capture the raw 404 body to confirm if it's a routing issue or model issue.
    try {
        console.error("Gemini API Error Object:", error);
        
        if (error.response) {
            displayMessage += ` (Status: ${error.response.status})`;
        }
        
        if (displayMessage.includes('{')) {
             const jsonMatch = displayMessage.match(/\{.*\}/s);
             if (jsonMatch) {
                 const parsed = JSON.parse(jsonMatch[0]);
                 if (parsed.error && parsed.error.message) {
                     displayMessage = `Google API Refusal: ${parsed.error.message}`;
                 }
             }
        }
    } catch (e) {
        // Fallback
    }

    if (displayMessage.includes('404')) {
         displayMessage += "\n👉 诊断: Nginx 转发路径已修复。如果仍报错，说明 Google 暂未向您的 API Key 开放 gemini-3-flash-preview 模型权限。";
    }

    log(`Message: ${displayMessage}`, 'error');
    return `分析失败。\n错误信息: ${displayMessage}`;
  }
};