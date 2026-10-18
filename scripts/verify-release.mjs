// Verify the packaged release in isolation: no source tree, no node_modules, temporary HOME.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'dist/release');
const tarballName = `llm-compare-v${version}-linux-x64.tar.gz`;
const tarball = join(out, tarballName);

function check(condition, message) {
  if (!condition) throw new Error(`发行版验收失败：${message}`);
  console.log(`✓ ${message}`);
}

check(existsSync(tarball), `存在 ${tarballName}`);
const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
check(sums.length === 1 && sums[0] === `${digest}  ${tarballName}`, 'SHA256SUMS 与 tar.gz 一致');

const temp = mkdtempSync(join(tmpdir(), 'llm-compare-verify-'));
let server;
try {
  const pkg = join(temp, 'pkg');
  const home = join(temp, 'home');
  for (const dir of [pkg, home]) spawnSync('mkdir', ['-p', dir]);
  const untar = spawnSync('tar', ['-xzf', tarball, '-C', pkg], { encoding: 'utf8', timeout: 60000 });
  check(untar.status === 0, '解压发布包');
  const files = readdirSync(pkg).sort();
  for (const name of ['llm-compare', 'LICENSE', 'install.sh', 'llm-compare.service', 'config.example.yaml', 'build-info.json', 'licenses']) {
    check(files.includes(name), `发布包包含 ${name}`);
  }
  check(!files.some((name) => /^(config\.yaml|data|.*\.sqlite.*|.*credentials.*|\.env.*)$/i.test(name)), '发布包不含本机配置、数据或凭据');
  const buildInfo = JSON.parse(readFileSync(join(pkg, 'build-info.json'), 'utf8'));

  // Public binary: our code must not carry private network addresses; nothing may carry build-machine paths.
  const webDir = join(root, 'apps/web/dist/assets');
  const ours = readFileSync(join(out, 'server.cjs'), 'utf8') + readdirSync(webDir).map((name) => readFileSync(join(webDir, name), 'latin1')).join('');
  const address = ours.match(/\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g)?.filter((ip) => !/\.0$|\.255$/.test(ip));
  check(!address?.length, `应用代码不含内网主机地址${address?.length ? `（发现 ${address.join(', ')}）` : ''}`);
  const binary = readFileSync(join(pkg, 'llm-compare')).toString('latin1');
  for (const local of [root, homedir()]) check(!binary.includes(local), `可执行文件不含本机路径 ${local}`);

  const env = { PATH: '/usr/bin:/bin', HOME: home, USER: process.env.USER ?? 'verify', LOG_LEVEL: 'info' };
  const bin = join(pkg, 'llm-compare');
  const exec = (args) => spawnSync(bin, args, { cwd: temp, env, encoding: 'utf8', timeout: 30000 });

  const versionRun = exec(['--version']);
  check(versionRun.status === 0, '--version 可运行');
  const reported = JSON.parse(versionRun.stdout);
  check(reported.version === version && reported.commit === buildInfo.commit, `版本与提交一致：${version} ${buildInfo.commit.slice(0, 7)}`);
  check(reported.node === `v${buildInfo.node}`, `内置 Node ${reported.node}`);

  const config = join(home, '.config/llm-compare/config.yaml');
  check(exec(['init', '--config', config]).status === 0, 'init 生成配置');
  const again = exec(['init', '--config', config]);
  check(again.status !== 0 && again.stderr.includes('拒绝覆盖'), 'init 拒绝覆盖已有配置');

  const port = await new Promise((done, fail) => {
    const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => done(free));
    });
  });
  const generated = parse(readFileSync(config, 'utf8'));
  check(generated.web_dist_dir === 'embedded', 'init 在发行版中默认使用内置前端');
  writeFileSync(config, stringify({ ...generated, server: { host: '127.0.0.1', port }, data_dir: join(temp, 'data'), work_root: join(temp, 'work') }));
  const doctor = exec(['doctor', '--config', config]);
  check(doctor.status === 0, `doctor 检查通过${doctor.status === 0 ? '' : `：${doctor.stderr.trim()}`}`);

  let log = '';
  server = spawn(bin, ['serve', '--config', config], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { log += chunk; });
  server.stderr.on('data', (chunk) => { log += chunk; });
  const exited = new Promise((done) => server.once('exit', (code, signal) => done({ code, signal })));
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
    if (server.exitCode !== null) throw new Error(`服务提前退出：\n${log}`);
    try { health = await (await fetch(`${base}/api/v1/health`)).json(); break; }
    catch { await new Promise((wait) => setTimeout(wait, 200)); }
  }
  check(health?.status === 'ok' && health.version === version && health.schema_version === buildInfo.schema, '服务启动且 health 返回版本与数据库结构');

  const page = await fetch(`${base}/`);
  const html = await page.text();
  check(page.status === 200 && page.headers.get('content-type').startsWith('text/html'), '首页返回 HTML');
  const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check(script !== undefined, '首页引用打包脚本');
  const asset = await fetch(`${base}${script}`);
  check(asset.status === 200 && asset.headers.get('content-type').startsWith('text/javascript') && asset.headers.get('cache-control').includes('immutable'), '脚本资源 MIME 与缓存正确');
  const deep = await fetch(`${base}/projects/verify-deep-link`);
  check(deep.status === 200 && (await deep.text()) === html, '页面深链接回退到首页');
  check((await fetch(`${base}/assets/missing.js`)).status === 404, '缺失资源返回 404');
  const unknown = await fetch(`${base}/api/v1/verify-unknown`);
  check(unknown.status === 404 && (await unknown.json()).error.code === 'not_found', '未知接口返回 JSON 404');
  const session = await fetch(`${base}/api/v1/ui-session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  const projects = await fetch(`${base}/api/v1/projects`, { headers: { cookie } });
  check(projects.status === 200 && Array.isArray((await projects.json()).items), 'SQLite 读写与项目接口可用');

  server.kill('SIGTERM');
  const result = await Promise.race([exited, new Promise((done) => setTimeout(() => done(null), 20000))]);
  check(result?.code === 0 && log.includes('服务已停止'), 'SIGTERM 后正常退出');
  server = undefined;
  console.log(`发行版验收通过：${tarballName}`);
} finally {
  if (server && server.exitCode === null) server.kill('SIGKILL');
  rmSync(temp, { recursive: true, force: true });
}
