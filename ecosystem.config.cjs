module.exports = {
  apps: [
    {
      name: 'liloidc',
      script: 'index.js',
      cwd: '/home/submin/www/demoid',
      instances: 1,
      autorestart: true,
      max_memory_restart: '128M',
      env: {
        NODE_ENV: 'production',
        PORT: 9876,
        ISSUER: 'https://demoid.stargan.id',
      },
    },
  ],
};
