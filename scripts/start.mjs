// Starts everything ReelCraft needs with one command: the local helper (tools)
// and the editor itself, then opens the browser.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const start = (label, cmd, args) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => console.log(`[${label}] stopped${code ? ` (code ${code})` : ''}`));
  children.push(child);
  return child;
};

start('helper', process.execPath, ['server/helper.mjs']);
start('editor', process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort']);

setTimeout(() => {
  if (process.platform === 'darwin') spawn('open', ['http://localhost:5173'], { stdio: 'ignore' });
}, 2500);

const stop = () => { children.forEach((c) => { try { c.kill(); } catch { /* gone */ } }); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
