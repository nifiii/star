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
} else {
    console.log('✅ public 目录已存在');
}

// 2. 如果配置文件不存在，立即创建占位符，防止前端 404 报错
if (!fs.existsSync(outputPath)) {
    try {
        const initialData = { 
            status: "initializing", 
            timestamp: Date.now(),
            message: "Script started, waiting for login..." 
        };
        fs.writeFileSync(outputPath, JSON.stringify(initialData, null, 2));
        console.log('✨ 已创建初始化 auth_config.json 占位文件');
    } catch (e) {
        console.error('❌ 创建初始化文件失败:', e.message);
    }
} else {
    console.log('✅ 发现现有 auth_config.json，准备覆盖更新...');
}

// 您的账号信息
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

const LOGIN_PAGE = 'https://sports.ymq.me/mobile/home';
// 设置自动刷新间隔：2小时50分钟
const REFRESH_INTERVAL = 2 * 50 * 60 * 1000; 

async function runTask() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 启动自动登录任务...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Mobile Safari/537.36');
    
    let tokenData = null;

    // 监听网络请求
    page.on('response', async (response) => {
      const url = response.url();
      const request = response.request();
      
      if ((url.includes('login') || url.includes('getUserInfo') || url.includes('getGameList')) && url.includes('ymq.me')) {
        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data?.header?.token) {
              if (!tokenData) {
                console.log('⚡ 捕获到 Token!');
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
        } catch (e) { /* ignore */ }
      }
      
      const reqHeaders = request.headers();
      if (!tokenData && reqHeaders['token']) {
         console.log('⚡ 从请求头中提取到 Token!');
         tokenData = {
           token: reqHeaders['token'],
           sn: reqHeaders['sn'] || '',
           snTime: Date.now(),
           username: CREDENTIALS.username,
           updatedAt: new Date().toLocaleString()
         };
      }
    });

    console.log(`🔗 前往页面: ${LOGIN_PAGE}`);
    await page.goto(LOGIN_PAGE, { waitUntil: 'networkidle0', timeout: 30000 });

    // 自动登录逻辑
    const passwordInput = await page.$('input[type="password"]');

    if (passwordInput) {
      console.log('🔒 需要登录，正在输入账号密码...');
      const inputs = await page.$$('input:not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"])');
      let userInput = inputs.length > 0 ? inputs[0] : null;

      if (userInput) {
        await userInput.click({ clickCount: 3 });
        await userInput.type(CREDENTIALS.username, { delay: 20 });
        
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.type(CREDENTIALS.password, { delay: 20 });
        
        const btn = await page.evaluateHandle(() => {
          const elements = [...document.querySelectorAll('button, div, a, span')];
          return elements.find(el => el.innerText && el.innerText.includes('登录') && !el.innerText.includes('注册'));
        });
        
        if (btn) {
           await btn.click();
        } else {
           await passwordInput.press('Enter');
        }
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      }
    } else {
      console.log('✅ 页面似乎已登录，尝试刷新以触发接口...');
      await page.reload({ waitUntil: 'networkidle0' });
    }

    // 等待捕获
    const startTime = Date.now();
    while (!tokenData && Date.now() - startTime < 10000) {
      await new Promise(r => setTimeout(r, 500));
    }

    if (tokenData) {
      fs.writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));
      console.log(`💾 凭证已更新并写入: ${outputPath}`);
      console.log(`🔑 Token Preview: ${tokenData.token.substring(0, 10)}...`);
    } else {
      console.error('❌ 本次获取失败，未捕获到 Token。将在下个周期重试。');
    }

  } catch (error) {
    console.error('❌ 任务出错:', error.message);
  } finally {
    await browser.close();
  }
}

// 立即运行一次，然后开启定时任务
(async () => {
  await runTask();
  setInterval(runTask, REFRESH_INTERVAL);
  console.log('💤 后台驻留中，请勿关闭此窗口...');
})();
