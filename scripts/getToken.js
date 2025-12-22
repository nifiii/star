import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 解决 ES Module 中 __dirname 不可用的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const outputPath = path.resolve(publicDir, 'auth_config.json');

// 您的账号信息
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

const HOME_PAGE = 'https://sports.ymq.me/mobile/home';
const LOGIN_PAGE_CHECK = 'https://sports.ymq.me/mobile/login'; // 某些情况下的登录页

async function debugLogin() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🕵️‍♂️ 开始登录流程深度调试...`);
  console.log(`👤 尝试登录账号: ${CREDENTIALS.username}`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    // 模拟 iPhone X 这里的 UserAgent 和 Viewport 很重要，防止被识别为爬虫
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1');

    // =================================================================
    // 1. 监听网络层：专门抓取 Login 接口的请求和响应
    // =================================================================
    await page.setRequestInterception(true);
    
    page.on('request', request => {
        const url = request.url();
        // 忽略静态资源，减少噪音
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
            request.continue();
            return;
        }

        // 重点监听 login 接口
        if (url.includes('/login') && request.method() === 'POST') {
            console.log('\n🔵 [发起登录请求] URL:', url);
            console.log('   📦 请求参数 (Post Data):', request.postData());
        }

        request.continue();
    });

    page.on('response', async response => {
        const url = response.url();
        
        // 重点监听 login 接口的返回
        if (url.includes('/login') && response.request().method() === 'POST') {
            console.log('\n🟢 [登录接口返回] Status:', response.status());
            try {
                const json = await response.json();
                console.log('   📦 返回数据 (JSON):');
                console.log(JSON.stringify(json, null, 2));
                
                if (json.code === '200' || json.success === true || (json.header && json.header.token)) {
                    console.log('   ✅ 接口判定：登录成功！');
                } else {
                    console.log('   ❌ 接口判定：登录可能失败 (请检查 msg 字段)');
                }
            } catch (e) {
                console.log('   ⚠️ 无法解析返回 JSON:', await response.text());
            }
        }
    });

    // =================================================================
    // 2. 模拟用户操作流程
    // =================================================================
    
    console.log(`\n🔗 [1/4] 前往首页: ${HOME_PAGE}`);
    await page.goto(HOME_PAGE, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // 打印当前页面状态
    let title = await page.title();
    console.log(`   当前页面标题: "${title}"`);

    // 检查是否在登录页，或者有密码框
    const passwordInput = await page.$('input[type="password"]');

    if (passwordInput) {
        console.log('\n⌨️ [2/4] 发现登录表单，正在输入账号密码...');
        
        // 查找所有输入框
        const inputs = await page.$$('input:not([type="hidden"])');
        
        // 输入用户名 (通常是第一个可见输入框)
        if (inputs.length > 0) {
            await inputs[0].click({ clickCount: 3 });
            await inputs[0].type(CREDENTIALS.username, { delay: 100 });
        }
        
        // 输入密码
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.type(CREDENTIALS.password, { delay: 100 });

        // 点击登录按钮
        console.log('🖱️ [3/4] 点击登录按钮...');
        
        // 尝试多种方式定位登录按钮
        const loginBtn = await page.evaluateHandle(() => {
            // 策略：找内容包含“登录”的按钮或div
            const allDivs = Array.from(document.querySelectorAll('button, div, span'));
            return allDivs.find(el => el.innerText.trim() === '登录' && el.offsetParent !== null);
        });

        if (loginBtn && loginBtn.asElement()) {
            await loginBtn.asElement().click();
        } else {
            console.log('   ⚠️ 未找到明确的“登录”按钮，尝试按回车键提交...');
            await passwordInput.press('Enter');
        }

        // 等待页面跳转或接口返回
        console.log('⏳ 等待跳转 (5秒)...');
        await new Promise(r => setTimeout(r, 5000));

    } else {
        console.log('✅ 未发现密码框，推测 Cookie 有效，已经是登录状态。');
    }

    // =================================================================
    // 3. 验证登录结果 (关键步骤)
    // =================================================================
    console.log('\n📸 [4/4] 登录后状态检查:');
    
    const finalUrl = page.url();
    const finalTitle = await page.title();
    console.log(`   📍 当前 URL: ${finalUrl}`);
    console.log(`   📍 当前 Title: ${finalTitle}`);

    // 打印页面可见文本，这是确认是否登录最直观的方法
    // 如果登录成功，通常会看到“赛事列表”、“我的”、“积分”等词汇
    // 如果失败，可能会看到“请输入账号”、“密码错误”等
    const pageText = await page.evaluate(() => {
        return document.body.innerText
            .replace(/\s+/g, ' ') // 压缩空格
            .substring(0, 300);   // 只取前300字
    });
    
    console.log('   👀 页面可见文字预览:');
    console.log(`   "${pageText}..."`);

    // 尝试跳转到个人中心做二次确认
    if (!finalUrl.includes('mine')) {
        console.log('\n➡️ 尝试跳转到个人中心 (mobile/mine) 做最终确认...');
        await page.goto('https://sports.ymq.me/mobile/mine', { waitUntil: 'networkidle2' });
        const mineText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').substring(0, 300));
        console.log(`   👀 个人中心文字预览: "${mineText}..."`);
        
        if (mineText.includes(CREDENTIALS.username) || mineText.includes('设置') || mineText.includes('退出')) {
             console.log('\n🎉🎉🎉 结论：登录成功！(在页面上找到了个人信息)');
        } else {
             console.log('\n⚠️⚠️⚠️ 结论：登录状态存疑，未在个人中心找到典型关键词。');
        }
    }

  } catch (error) {
    console.error('❌ 调试过程出错:', error);
  } finally {
    if (browser) await browser.close();
    console.log('\n🏁 调试结束。请分析上方日志中的 [登录接口返回] 和 [页面可见文字预览]。');
  }
}

// 运行调试
debugLogin();
