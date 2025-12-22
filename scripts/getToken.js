import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const outputPath = path.resolve(publicDir, 'auth_config.json');

// 用户配置
const CREDENTIALS = {
  username: process.env.HTH_USER || '13261316191',
  password: process.env.HTH_PASS || 'Gao@2018.com'
};

// 1. 登录专用固定配置 (来自您的 CURL)
// 这个 Token 和 SN 是用于 "握手" 登录的，似乎是客户端的硬编码值
const LOGIN_HANDSHAKE_HEADERS = {
    token: "DLFFG4-892b3448b953b5da525470ec2e5147d1202a126c",
    sn: "2b3467f4850c6743673871aa6c281f6a",
    from: "web"
};

// 2. 数据查询专用固定 SN (来自您的 Rank 接口 CURL)
// 登录成功后，我们将把这个 SN 写入配置文件供前端使用
const DATA_QUERY_SN = "9cc07cfedc454229063eb32c3045c5ae"; 

async function loginAndSave() {
  console.log(`\n==================================================`);
  console.log(`[${new Date().toLocaleTimeString()}] 🚀 开始直接调用登录接口...`);
  console.log(`👤 用户名: ${CREDENTIALS.username}`);
  console.log(`==================================================`);

  const loginUrl = `https://user.ymq.me/public/public/login?t=${Date.now()}`;
  const requestTime = Date.now();

  // 构造登录 Payload
  const payload = {
      body: {
          identifier: CREDENTIALS.username,
          credential: CREDENTIALS.password,
          client_id: 1000,
          identity_type: 1
      },
      header: {
          token: LOGIN_HANDSHAKE_HEADERS.token,
          sn: LOGIN_HANDSHAKE_HEADERS.sn,
          snTime: requestTime,
          from: LOGIN_HANDSHAKE_HEADERS.from
      }
  };

  // 打印请求日志 (隐藏密码)
  const logPayload = JSON.parse(JSON.stringify(payload));
  logPayload.body.credential = "******";
  console.log('📤 发送请求 Payload:', JSON.stringify(logPayload, null, 2));

  try {
      const response = await fetch(loginUrl, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://sports.ymq.me',
              'Referer': 'https://sports.ymq.me/',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
          },
          body: JSON.stringify(payload)
      });

      const data = await response.json();

      console.log(`\n📥 收到响应 (Status: ${response.status}):`);
      console.log(JSON.stringify(data, null, 2));

      if (data.code === 1 && data.userinfo && data.userinfo.token) {
          console.log('\n✅ 登录成功!');
          
          const newToken = data.userinfo.token;
          console.log(`\n🔑 ---------------- TOKEN ----------------`);
          console.log(newToken);
          console.log(`------------------------------------------\n`);

          // 构造保存的数据
          // 注意：这里保存的 SN 是用于后续数据查询的 DATA_QUERY_SN
          const configData = {
              token: newToken,
              sn: DATA_QUERY_SN, 
              snTime: Date.now(), // 记录获取时间，虽然前端请求会用最新的
              username: data.userinfo.nickname || CREDENTIALS.username,
              updatedAt: new Date().toLocaleString(),
              status: "active"
          };

          // 确保目录存在
          if (!fs.existsSync(publicDir)){
              fs.mkdirSync(publicDir, { recursive: true });
          }

          fs.writeFileSync(outputPath, JSON.stringify(configData, null, 2));
          console.log(`💾 凭证已保存至: ${outputPath}`);

          // 验证一下
          await verifyToken(configData);

      } else {
          console.error('❌ 登录失败。API 返回错误代码或缺少 Token。');
      }

  } catch (error) {
      console.error('❌ 请求出错:', error);
  }
}

async function verifyToken(config) {
    console.log('\n🧪 验证 Token 有效性 (获取赛事列表)...');
    try {
        const verifyUrl = `https://applyv3.ymq.me/public/public/getgamefulllist?t=${Date.now()}`;
        const res = await fetch(verifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://sports.ymq.me',
                'Referer': 'https://sports.ymq.me/'
            },
            body: JSON.stringify({
                body: { 
                    page_num: 1, 
                    page_size: 1, 
                    statuss: [10], 
                    province: ["广东省"] 
                },
                header: { 
                    token: config.token, 
                    sn: config.sn, 
                    snTime: Date.now(), // 验证时也使用当前时间
                    from: "web" 
                } 
            })
        });
        const json = await res.json();
        console.log('📦 验证响应:', JSON.stringify(json).substring(0, 200) + (JSON.stringify(json).length > 200 ? '...' : ''));
        
        if (json?.data?.list) {
            console.log('✅ Token 有效，数据获取正常。');
        } else {
            console.warn('⚠️ Token 似乎有效但未返回列表数据，请检查。');
        }
    } catch (e) {
        console.error('❌ 验证过程出错', e);
    }
}

// 立即执行
loginAndSave();

// 如果是在 Docker 或长期运行环境中，可以取消下面的注释开启定时刷新
// setInterval(loginAndSave, 2 * 60 * 60 * 1000); // 2小时刷新一次