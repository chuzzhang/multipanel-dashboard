// pm2 进程管理配置
// 用法：pm2 start ecosystem.config.js  →  pm2 save  →  pm2 startup
module.exports = {
  apps: [
    {
      name: 'multipanel',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1', // 反代代理用本机即可；直接公网访问改成 0.0.0.0
        PORT: 8787,
        // 首次启动预置管理员密码（可选，已设置过会忽略）：
        // ADMIN_PASSWORD: 'change-me-please',
        // 走反向代理时，如果代理改写了 Host，把它设成对外访问地址：
        // PUBLIC_URL: 'https://mp.example.com',
        ALLOW_INSECURE_TLS: '1' // 自建面板常有自签证书；要严格校验改成 '0'
      }
    }
  ]
};
