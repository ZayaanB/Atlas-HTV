import { buildApp } from './app.js';
import { readConfig } from './config.js';
async function main() {
  const config = readConfig();
  const app = await buildApp(config);
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    const timer = setTimeout(() => { process.exitCode = 1; process.exit(1); },15000).unref();
    try { await app.close(); }
    catch { process.exitCode = 1; }
    finally { clearTimeout(timer); }
  };
  process.once('SIGINT',close); process.once('SIGTERM',close);
  try { await app.listen({host:config.host,port:config.port}); }
  catch { await close(); throw new Error('Server could not start'); }
}
main().catch(() => { console.error('Atlas startup failed; check validated configuration and integration handoffs.'); process.exitCode = 1; });
