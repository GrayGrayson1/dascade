import { createDascadeServer } from './server.ts';
import { config, supabaseEnabled } from './config.ts';
import { log } from './lib/log.ts';

const server = await createDascadeServer({ serveWeb: config.isProduction || process.env.SERVE_WEB === '1' });

await server.listen(config.port, config.host);
log.info(`DASCADE game server listening on http://${config.host}:${config.port}`, {
  persistence: supabaseEnabled ? 'supabase' : 'none',
  mode: config.isProduction ? 'production' : 'development',
});
