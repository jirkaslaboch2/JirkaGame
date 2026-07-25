module.exports = {
  apps: [{
    name: 'lootvault-shop',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
