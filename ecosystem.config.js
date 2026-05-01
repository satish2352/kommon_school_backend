/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.js          — start in cluster mode
 *   pm2 reload ecosystem.config.js         — zero-downtime reload
 *   pm2 stop kommon-school-api
 *   pm2 delete kommon-school-api
 *   pm2 logs kommon-school-api
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'kommon-school-api',
      script: 'dist/server.js',
      node_args: '-r module-alias/register',

      // Cluster mode — one process per CPU core
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Auto-restart settings
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 1000,
      max_memory_restart: '500M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        LOG_PRETTY: 'false',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_PRETTY: 'true',
        LOG_LEVEL: 'debug',
      },

      // Watch — disabled in production
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'dist'],

      // Source maps for error traces
      source_map_support: true,
    },
  ],
};
