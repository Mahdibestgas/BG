import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { createApp } from './app';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT || 8990);
  const host = process.env.CF13_HOST || '127.0.0.1';   // 0.0.0.0 only inside the container; the proxy is the only way in
  await app.listen(port, host);
  console.log('Cash Flow 13 API on http://' + host + ':' + port);
}
main().catch((e) => { console.error(e); process.exit(1); });
