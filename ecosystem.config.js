module.exports = {
  apps: [
    {
      name: 'adapter',
      script: './app.js',
      cwd: '/root/adapter',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
