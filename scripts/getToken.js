import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 解决 ES Module 中 __dirname 不可用的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const outputPath = path.resolve(publicDir, 'auth_config.json');

console.log('-------------------------------------------');
console.log('📂 运行目录 (CWD):', process.cwd());
console.log('📂 脚本所在目录:', __dirname);
console.log('📂 目标文件路径:', outputPath);
console.log('-------------------------------------------');

// 1. 初始化检查：确保 public 目录存在
if (!fs.existsSync(publicDir)){
    try {
        fs.mkdirSync(publicDir, { recursive: true });
        console.log('📁 已创建 public 目录:', publicDir);
    } catch (e) {
        console.error('❌ 创建目录失败:', e.message);
    }
}

// 2. 如果配置文件不存在，立即创建占位符
if (!fs.existsSync(outputPath)) {
    try {
        const initialData = { 
            status: "initializing", 
            timestamp: Date.now(),
            message: "Script started, waiting for login..." 
        };
        fs.writeFileSync(outputPath, JSON.stringify(initialData, null, 2));
    } catch (e) { /* ignore */ }
}

// 您的账号信息
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

const HOME_PAGE = 'https://sports.ymq.me/mobile/home';
const MINE_PAGE = 'https://sports.ymq.me/mobile/mine';
const REFRESH_INTERVAL = 2 * 50 * 60 * 1000; 

async function runTask() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 启动自动登录任务...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Docker 环境常用优化
        '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    // 模拟 iPhone X
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1');
    
    let tokenData = null;

    // --- 核心逻辑修改：监听 Request 的 Post Data ---
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        const resourceType = request.resourceType();
        const method = request.method();

        // 1. 打印 API 请求日志 (过滤掉图片/CSS等)
        if (url.includes('ymq.me') && (resourceType === 'xhr' || resourceType === 'fetch')) {
            console.log(`   -> REQ [${method}]: ${url.split('?')[0].split('/').pop()}`); 
        }

        // 2. 关键：解析 Request Payload (Post Data)
        // 目标接口: getgamefulllist, getUserInfo, login 等都会在 body 中带上 header 对象
        if (method === 'POST' && url.includes('ymq.me')) {
            const postData = request.postData();
            if (postData) {
                try {
                    const json = JSON.parse(postData);
                    // 检查结构: { header: { token: "...", sn: "..." } }
                    // 这是根据您的日志分析出来的最准确的数据源
                    if (json?.header?.token && json?.header?.sn) {
                         // 防止覆盖，优先捕获
                        if (!tokenData) {
                             console.log(`⚡ [Request Payload] 成功捕获凭证! 来源: ${url.split('/').pop()}`);
                             console.log(`   Token: ${json.header.token.substring(0, 10)}...`);
                             console.log(`   SN:    ${json.header.sn.substring(0, 10)}...`);
                             
                             tokenData = {
                                token: json.header.token,
                                sn: json.header.sn,
                                snTime: json.header.snTime || Date.now(),
                                username: CREDENTIALS.username,
                                updatedAt: new Date().toLocaleString()
                             };
                        }
                    }
                } catch (e) {
                    // 忽略非 JSON 的 post data
                }
            }
        }
        
        request.continue();
    });

    // --- 辅助逻辑：保留监听响应作为备份 ---
    page.on('response', async (response) => {
      const url = response.url();
      if ((url.includes('login') || url.includes('getUserInfo')) && url.includes('ymq.me')) {
        try {
          // 有些接口可能会在 Response 中返回新的 Token，作为备份检查
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data?.header?.token && !tokenData) {
               console.log(`⚡ [Response Body] 捕获到 Token: ${url}`);
               tokenData = {
                  token: data.header.token,
                  sn: data.header.sn || '',
                  snTime: Date.now(),
                  username: CREDENTIALS.username,
                  updatedAt: new Date().toLocaleString()
               };
            }
          }
        } catch (e) { /* ignore */ }
      }
    });

    console.log(`🔗 前往首页: ${HOME_PAGE}`);
    // 使用 networkidle2 (至少2个网络连接空闲)
    await page.goto(HOME_PAGE, { waitUntil: 'networkidle2', timeout: 45000 });

    const title = await page.title();
    console.log(`📄 页面加载完成: "${title}"`);

    // 检查是否需要登录
    const passwordInput = await page.$('input[type="password"]');

    if (passwordInput) {
      console.log('🔒 发现密码输入框，执行登录...');
      const inputs = await page.$$('input:not([type="hidden"])');
      if (inputs.length >= 2) {
          await inputs[0].click({ clickCount: 3 });
          await inputs[0].type(CREDENTIALS.username, { delay: 50 });
          
          const passInput = await page.$('input[type="password"]');
          if (passInput) {
              await passInput.click({ clickCount: 3 });
              await passInput.type(CREDENTIALS.password, { delay: 50 });
              
              // 提交登录
              const loginBtn = await page.evaluateHandle(() => {
                  const elements = Array.from(document.querySelectorAll('button, div[role="button"], span, div'));
                  return elements.find(el => (el.innerText || '').trim() === '登录');
              });
              if (loginBtn && loginBtn.asElement()) {
                  await loginBtn.asElement().click();
              } else {
                  await passInput.press('Enter');
              }
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
          }
      }
    } else {
      console.log('✅ 看起来已经登录了。');
      // 如果还没捕获到 Token，尝试跳转到个人中心触发更多接口
      if (!tokenData) {
          console.log(`➡️ 跳转至个人中心 (${MINE_PAGE}) 以触发接口...`);
          await page.goto(MINE_PAGE, { waitUntil: 'networkidle2', timeout: 30000 });
      }
    }

    // 等待捕获 Token
    console.log('⏳ 等待数据捕获 (10秒)...');
    const startTime = Date.now();
    while (!tokenData && Date.now() - startTime < 10000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (tokenData) {
      fs.writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));
      console.log(`💾 凭证已更新并写入: ${outputPath}`);
    } else {
      console.error('❌ 本次任务失败：页面请求已发送，但未解析到 Header 中的 Token。');
    }

  } catch (error) {
    console.error('❌ 致命错误:', error);
  } finally {
    if (browser) await browser.close();
  }
}

// 立即运行
(async () => {
  await runTask();
  setInterval(runTask, REFRESH_INTERVAL);
  console.log('💤 脚本进入后台轮询模式...');
})();