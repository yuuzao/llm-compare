import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const nodeVersion = '26.11.1';
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Release 构建当前只支持 Linux x86_64');
const out = resolve('dist/release');
const cache = resolve('dist/toolchain');
mkdirSync(out, { recursive: true }); mkdirSync(cache, { recursive: true });
const nodeName = `node-v${nodeVersion}-linux-x64`;
const archiveName = `${nodeName}.tar.xz`;
const checksums = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '60', `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`], { encoding: 'utf8', timeout: 70000 });
const expected = checksums.split('\n').find((line) => line.endsWith(`  ${archiveName}`))?.split(' ')[0];
if (!expected) throw new Error('Node 官方校验表没有目标文件');
const archive = join(cache, archiveName);
if (!existsSync(archive)) execFileSync('curl', ['--fail', '--show-error', '--location', '--max-time', '300', '--output', archive, `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`], { stdio: 'inherit', timeout: 310000 });
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (digest !== expected) { rmSync(archive); throw new Error('Node 下载校验失败，已删除文件'); }
execFileSync('tar', ['-xJf', archive, '-C', cache], { timeout: 60000 });
const node = join(cache, nodeName, 'bin/node');
// build-info.json claims a commit; refuse to build shipped content that differs from it.
const shipped = ['apps', 'packages', 'scripts', 'packaging', 'docs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'config.example.yaml'];
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...shipped], { encoding: 'utf8' }).trim();
if (dirty && process.env.LLM_COMPARE_ALLOW_DIRTY !== '1') throw new Error(`工作区有未提交的发布内容，提交后再构建：\n${dirty}`);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() + (dirty ? '-dirty' : '');
const stage = join(out, 'package');
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
await build({
  entryPoints: ['apps/server/src/cli.ts'], bundle: true, platform: 'node', target: 'node26',
  format: 'cjs', outfile: join(out, 'server.cjs'),
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_COMMIT__: JSON.stringify(commit) },
  metafile: true,
}).then(({ metafile }) => {
  for (const output of Object.values(metafile.outputs)) for (const dependency of output.imports) {
    if (dependency.external && !dependency.path.startsWith('node:') && !builtinModules.includes(dependency.path)) throw new Error(`未打包的外部依赖：${dependency.path}`);
  }
  writeFileSync(join(out, 'bundle-meta.json'), JSON.stringify(metafile, null, 2));
});
const assets = {};
function visit(directory, prefix) {
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, file.name), key = `${prefix}/${file.name}`;
    if (file.isDirectory()) visit(path, key);
    else assets[key] = path;
  }
}
visit(resolve('apps/web/dist'), 'web');
if (!assets['web/index.html']) throw new Error('缺少前端构建产物');
const binary = join(stage, 'llm-compare');
const sea = join(out, 'sea.json');
// The SEA blob records the main script path; keep it relative so no build-machine path ships.
const relativeAssets = Object.fromEntries(Object.entries(assets).map(([key, path]) => [key, relative(out, path)]));
writeFileSync(sea, JSON.stringify({ main: 'server.cjs', mainFormat: 'commonjs', output: relative(out, binary), assets: relativeAssets, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, execArgvExtension: 'none' }, null, 2));
execFileSync(node, ['--build-sea', 'sea.json'], { cwd: out, stdio: 'inherit', timeout: 120000 });
chmodSync(binary, 0o755);
for (const file of ['LICENSE', 'config.example.yaml', 'packaging/llm-compare.service', 'packaging/install.sh', 'docs/安装与发布.md']) cpSync(file, join(stage, file.split('/').at(-1)));
writeFileSync(join(stage, 'build-info.json'), JSON.stringify({ version, commit, node: nodeVersion, platform: 'linux-x64', schema: 4 }, null, 2) + '\n');
// Include licenses for all packages that actually contribute to the server bundle,
// plus the embedded front-end dependencies and the bundled Node runtime.
const licenses = join(stage, 'licenses'); mkdirSync(licenses);
let count = 0;
function collect(directory, prefix) {
  if (!existsSync(directory)) return;
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    if (/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file.name) && file.isFile()) {
      cpSync(join(directory, file.name), join(licenses, `${prefix}-${file.name}`)); count++;
    }
  }
}
for (const pkg of readdirSync('node_modules/.pnpm')) {
  const directory = join('node_modules/.pnpm', pkg, 'node_modules');
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('@') && entry.isDirectory()) for (const sub of readdirSync(join(directory, entry.name))) collect(join(directory, entry.name, sub), `${entry.name.slice(1)}-${sub}`);
    else if (entry.isDirectory()) collect(join(directory, entry.name), entry.name);
  }
}
collect(join(cache, nodeName), 'node');
if (!count) throw new Error('第三方许可证收集为空');
const tarball = join(out, `llm-compare-v${version}-linux-x64.tar.gz`);
execFileSync('tar', ['-czf', tarball, '-C', stage, '.'], { timeout: 120000 });
writeFileSync(join(out, 'SHA256SUMS'), `${createHash('sha256').update(readFileSync(tarball)).digest('hex')}  ${tarball.split('/').at(-1)}\n`);
console.log(`Release 已生成：${tarball}`);
