import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(worktree, 'hardware', 'smart-cane', 'tests', 'proximity-feedback.test.cpp');

function splitArgs(value) {
  if (!value) return [];
  return value.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s]+/g)
    ?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? [];
}

function commandWorks(command, args) {
  const result = spawnSync(command, [...args, '--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function findCompiler() {
  if (process.env.CXX) {
    return {
      command: process.env.CXX,
      prefix: splitArgs(process.env.CXX_ARGS),
    };
  }

  const cachedZigRoot = join(worktree, '.agent-loop', 'tools');
  const cachedZig = [
    join(cachedZigRoot, 'zig-x86_64-windows-0.16.0', 'zig.exe'),
    join(cachedZigRoot, 'zig', 'zig.exe'),
  ].find((candidate) => existsSync(candidate));
  if (cachedZig) return { command: cachedZig, prefix: ['c++'] };

  for (const command of ['clang++', 'g++', 'c++', 'cl']) {
    if (commandWorks(command, [])) return { command, prefix: [] };
  }
  return null;
}

const compiler = findCompiler();
if (!compiler) {
  console.error('No host C++ compiler found. Set CXX (and optional CXX_ARGS) or install an isolated compiler under .agent-loop/tools.');
  process.exitCode = 2;
} else {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cane-feedback-'));
  const executable = join(temporaryDirectory, process.platform === 'win32' ? 'proximity-feedback-test.exe' : 'proximity-feedback-test');
  const isMsvc = basename(compiler.command).toLowerCase() === 'cl.exe' || basename(compiler.command).toLowerCase() === 'cl';
  const isZig = basename(compiler.command).toLowerCase() === 'zig.exe' || basename(compiler.command).toLowerCase() === 'zig';
  const compileArgs = isMsvc
    ? [...compiler.prefix, '/nologo', '/std:c++14', source, `/Fe:${executable}`]
    : [...compiler.prefix, '-std=c++11', '-Wall', '-Wextra', ...(isZig ? ['-nostdinc++', '-nostdlib++', '-fno-exceptions'] : []), source, '-o', executable];

  try {
    const compile = spawnSync(compiler.command, compileArgs, {
      cwd: worktree,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (compile.error || compile.status !== 0) {
      process.stderr.write(compile.stderr || compile.error?.message || 'C++ compilation failed.\n');
      process.exitCode = 1;
    } else {
      const run = spawnSync(executable, [], {
        cwd: worktree,
        encoding: 'utf8',
        windowsHide: true,
      });
      process.stdout.write(run.stdout || '');
      process.stderr.write(run.stderr || '');
      process.exitCode = run.status ?? 1;
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
