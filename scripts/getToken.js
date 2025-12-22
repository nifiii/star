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

    // --- 增强日志：监听请求 ---
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        if (url.includes('ymq.me') && (request.resourceType() === 'xhr' || request.resourceType() === 'fetch')) {
            console.log(`   -> REQ: ${url.split('?')[0].split('/').pop()}`); // 只打印文件名，保持整洁
        }
        request.continue();
    });

    // --- 监听响应捕获 Token ---
    page.on('response', async (response) => {
      const url = response.url();
      const request = response.request();
      
      // 检查 Response Body (JSON)
      if ((url.includes('login') || url.includes('getUserInfo') || url.includes('getGameList')) && url.includes('ymq.me')) {
        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('application/json')) {
            // 克隆 token 处理逻辑
            const data = await response.json();
            if (data?.header?.token) {
              if (!tokenData) {
                console.log(`⚡ [Body] 成功捕获 Token: ${url}`);
                tokenData = {
                  token: data.header.token,
                  sn: data.header.sn || '',
                  snTime: Date.now(),
                  username: CREDENTIALS.username,
                  updatedAt: new Date().toLocaleString()
                };
              }
            }
          }
        } catch (e) { /* ignore json parse errors */ }
      }
      
      // 检查 Request Headers (Token 复用)
      const reqHeaders = request.headers();
      if (!tokenData && reqHeaders['token']) {
         // 过滤掉空 token 或 'undefined' 字符串
         if (reqHeaders['token'] && reqHeaders['token'] !== 'undefined') {
             console.log(`⚡ [Header] 成功提取 Token: ${url.split('/').pop()}`);
             tokenData = {
               token: reqHeaders['token'],
               sn: reqHeaders['sn'] || '',
               snTime: Date.now(),
               username: CREDENTIALS.username,
               updatedAt: new Date().toLocaleString()
             };
         }
      }
    });

    console.log(`🔗 前往首页: ${HOME_PAGE}`);
    // 使用 networkidle2 (至少2个网络连接空闲)，比 networkidle0 更宽容，防止长轮询卡住
    await page.goto(HOME_PAGE, { waitUntil: 'networkidle2', timeout: 45000 });

    const currentUrl = page.url();
    const title = await page.title();
    console.log(`📄 页面加载完成: "${title}" [${currentUrl}]`);

    // 打印页面上的部分文本，帮助判断状态
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').substring(0, 100));
    console.log(`👀 页面预览: ${bodyText}...`);

    // 检查密码框
    const passwordInput = await page.$('input[type="password"]');

    if (passwordInput) {
      console.log('🔒 发现密码输入框，准备登录...');
      
      // 尝试寻找账号输入框
      // 很多移动端页面是先输入账号，或者账号框就在密码框上面
      // 我们找所有 visible 的 input
      const inputs = await page.$$('input:not([type="hidden"])');
      console.log(`📝 发现 ${inputs.length} 个输入框`);
      
      // 假设第一个是账号，第二个是密码（通常情况）
      // 或者根据 placeholder 查找 (如果有)
      
      if (inputs.length >= 2) {
          // 清空并输入账号
          await inputs[0].click({ clickCount: 3 });
          await inputs[0].type(CREDENTIALS.username, { delay: 50 });
          
          // 清空并输入密码
          // 重新获取 passwordInput 确保引用有效
          const passInput = await page.$('input[type="password"]');
          if (passInput) {
              await passInput.click({ clickCount: 3 });
              await passInput.type(CREDENTIALS.password, { delay: 50 });
              
              // 寻找登录按钮
              // 策略：寻找包含“登录”文本的 button 或 div
              const loginBtn = await page.evaluateHandle(() => {
                  const elements = Array.from(document.querySelectorAll('button, div[role="button"], span, div'));
                  return elements.find(el => {
                      const text = el.innerText ? el.innerText.trim() : '';
                      return text === '登录' && el.offsetParent !== null; // visible check
                  });
              });

              if (loginBtn && loginBtn.asElement()) {
                  console.log('🖱️ 点击登录按钮...');
                  await loginBtn.asElement().click();
              } else {
                  console.log('⚠️ 未找到明显的登录按钮，尝试回车提交...');
                  await passInput.press('Enter');
              }
              
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(e => console.log('Wait nav error (ignored):', e.message));
          }
      }

    } else {
      console.log('✅ 未找到密码框，推测可能已登录或在中间页。');
      
      const cookies = await page.cookies();
      console.log(`🍪 当前 Cookies: ${cookies.length} 个`);

      // 强制跳转到“我的”页面，这通常会触发 getUserInfo
      console.log(`➡️ 强制跳转至个人中心 (${MINE_PAGE}) 以刷新 Token...`);
      await page.goto(MINE_PAGE, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    // 等待捕获 Token
    console.log('⏳ 等待 Token 捕获 (10秒)...');
    const startTime = Date.now();
    while (!tokenData && Date.now() - startTime < 10000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (tokenData) {
      fs.writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));
      console.log(`🎉 成功！凭证已更新: ${outputPath}`);
      console.log(`🔑 Token: ${tokenData.token.substring(0, 15)}...`);
    } else {
      console.error('❌ 本次任务失败：页面已加载但未捕获到 Token。请检查上方请求日志。');
    }

  } catch (error) {
    console.error('❌ 致命错误:', error);
    // 截图帮助调试 (Base64)
    try {
        if (browser && browser.isConnected()) { // Ensure browser is still open
            const pages = await browser.pages();
            if (pages.length > 0) {
                 const title = await pages[0].title();
                 console.log(`出错时页面标题: ${title}`);
            }
        }
    } catch (e) {}
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
