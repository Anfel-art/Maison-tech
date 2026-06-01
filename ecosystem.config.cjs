/**
 * PM2 — Configuración de proceso de producción
 *
 * Instalación rápida:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                        # guarda la lista de procesos
 *   pm2 startup                     # genera el comando para auto-inicio con el SO
 *
 * Otros comandos útiles:
 *   pm2 logs seprisa-api            # ver logs en tiempo real
 *   pm2 restart seprisa-api         # reiniciar sin downtime
 *   pm2 stop seprisa-api            # detener
 *   pm2 monit                       # monitor de CPU/RAM en tiempo real
 */
module.exports = {
  apps: [
    {
      name: 'seprisa-api',
      script: './server/index.js',

      // Reiniciar automáticamente si el proceso cae
      autorestart: true,
      watch: false,           // en producción NO usar watch (reiniciaría ante cualquier cambio)
      max_restarts: 15,       // máximo de reinicios antes de marcar como errored
      restart_delay: 3000,    // esperar 3 s entre reinicios para evitar bucles rápidos
      min_uptime: '10s',      // si cae antes de 10 s, no cuenta como reinicio exitoso

      // Logs
      error_file: './logs/api-error.log',
      out_file:   './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Variables de entorno (los secretos van en .env, no aquí)
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};
