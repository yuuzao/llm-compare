// Publish a verified release to GitHub with a fixed contract that nvchecker relies on:
// tag v<package.json version>, non-prerelease marked latest, assets named by version.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const repo = 'yuuzao/llm-compare';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`版本号必须是 X.Y.Z：${version}`);
const tag = `v${version}`;
const out = join(root, 'dist/release');
const tarball = join(out, `llm-compare-${tag}-linux-x64.tar.gz`);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 60000 }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 600000 }).trim();

const { commit } = JSON.parse(readFileSync(join(out, 'package/build-info.json'), 'utf8'));
if (commit !== git('rev-parse', 'HEAD')) throw new Error(`产物提交 ${commit} 与当前 HEAD 不一致，请重新执行 pnpm release`);
git('fetch', '--tags', 'origin');
if (git('branch', '-r', '--contains', commit) === '') throw new Error('构建提交尚未推送到 origin，请先推送');
if (git('tag', '--list', tag)) throw new Error(`标签 ${tag} 已存在；变更发布内容必须递增 package.json 版本`);
const published = gh('release', 'list', '--repo', repo, '--json', 'tagName', '--jq', '.[].tagName').split('\n');
if (published.includes(tag)) throw new Error(`Release ${tag} 已存在`);

git('tag', '-a', tag, '-m', `llm-compare ${tag}`, commit);
git('push', 'origin', tag);
gh('release', 'create', tag, tarball, join(out, 'SHA256SUMS'), '--repo', repo, '--verify-tag', '--latest',
  '--title', `llm-compare ${tag}`,
  '--notes', `Linux x86_64 单文件可执行程序（内置 Node.js 与前端），附 systemd 用户服务单元。构建提交 ${commit.slice(0, 7)}。`);
const latest = gh('api', `repos/${repo}/releases/latest`, '--jq', '.tag_name');
if (latest !== tag) throw new Error(`releases/latest 返回 ${latest}，不是 ${tag}`);
console.log(`已发布 ${tag}：https://github.com/${repo}/releases/tag/${tag}`);
