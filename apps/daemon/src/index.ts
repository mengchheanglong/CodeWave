import { DEFAULT_DAEMON_PORT } from '@codewave/protocol';
import { CodeWaveDaemon } from './server.js';

const port = Number(process.env.CODEWAVE_PORT ?? DEFAULT_DAEMON_PORT);
const daemon = new CodeWaveDaemon(process.cwd(), port);

await daemon.start();

console.log(`CodeWave daemon listening on ${daemon.getBaseUrl()}`);
