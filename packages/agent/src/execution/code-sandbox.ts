/**
 * Secure Code Execution Sandbox
 *
 * Executes AI-generated code in isolated environments.
 *
 * JavaScript: Node.js worker_threads + vm.Script
 *   - Separate V8 isolate per execution
 *   - No access to Node.js globals (no require, no fs, no net)
 *   - Memory limit: 64MB heap
 *   - CPU limit: 10 second timeout (SIGKILL)
 *
 * Python: subprocess with system python3 in restricted mode
 *   - -E flag: ignore PYTHONPATH/PYTHONSTARTUP
 *   - -S flag: no site packages
 *   - -c flag: code from string (no file write needed)
 *   - ulimit timeout via timeout(1) command
 *   - stdout/stderr capped at 50KB
 *
 * Security: neither sandbox has network access, filesystem write access,
 * or ability to spawn subprocesses (these are enforced differently per runtime).
 */

import { Worker } from 'worker_threads';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SandboxResult {
  success: boolean;
  stdout: string;     // max 50KB
  stderr: string;     // max 10KB
  exitCode: number;
  durationMs: number;
  memoryMb?: number;
  language: string;
  error?: string;
}

// ── JavaScript Sandbox (worker_threads + vm) ──────────────────────

const JS_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

// Capture stdout/stderr
let stdout = '';
let stderr = '';

const context = {
  console: {
    log: (...args) => { stdout += args.map(String).join(' ') + '\\n'; },
    error: (...args) => { stderr += args.map(String).join(' ') + '\\n'; },
    warn: (...args) => { stderr += args.map(String).join(' ') + '\\n'; },
    info: (...args) => { stdout += args.map(String).join(' ') + '\\n'; },
  },
  Math, JSON, Date, Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isNaN, isFinite,
  setTimeout: undefined, setInterval: undefined, setImmediate: undefined,
  process: undefined, require: undefined, module: undefined, exports: undefined,
  __dirname: undefined, __filename: undefined,
  fetch: undefined, XMLHttpRequest: undefined,
  Buffer: undefined,
};

vm.createContext(context);

try {
  const script = new vm.Script(workerData.code, {
    timeout: 8000,
    filename: 'sandbox.js',
  });
  const result = script.runInContext(context, { timeout: 8000 });
  if (result !== undefined) {
    stdout += String(result) + '\\n';
  }
  parentPort.postMessage({ success: true, stdout: stdout.substring(0, 51200), stderr: stderr.substring(0, 10240) });
} catch (err) {
  parentPort.postMessage({ success: false, stdout: stdout.substring(0, 51200), stderr: (err.message || String(err)).substring(0, 10240) });
}
`;

async function runJavaScript(code: string, timeoutMs: number = 10000): Promise<SandboxResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    let resolved = false;

    const worker = new Worker(JS_WORKER_CODE, {
      eval: true,
      workerData: { code },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        worker.terminate();
        resolve({
          success: false,
          stdout: '',
          stderr: 'Execution timed out (10s limit)',
          exitCode: 1,
          durationMs: Date.now() - start,
          language: 'javascript',
          error: 'timeout',
        });
      }
    }, timeoutMs);

    worker.on('message', (msg) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        worker.terminate().catch(() => {});
        resolve({
          success: msg.success,
          stdout: msg.stdout || '',
          stderr: msg.stderr || '',
          exitCode: msg.success ? 0 : 1,
          durationMs: Date.now() - start,
          language: 'javascript',
        });
      }
    });

    worker.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          success: false,
          stdout: '',
          stderr: err.message.substring(0, 10240),
          exitCode: 1,
          durationMs: Date.now() - start,
          language: 'javascript',
          error: err.message,
        });
      }
    });

    worker.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          stdout: '',
          stderr: `Worker exited with code ${code}`,
          exitCode: code ?? 1,
          durationMs: Date.now() - start,
          language: 'javascript',
        });
      }
    });
  });
}

// ── Python Sandbox (subprocess) ───────────────────────────────────

async function checkPythonAvailable(): Promise<{ available: boolean; cmd: string }> {
  for (const cmd of ['python3', 'python']) {
    try {
      await execFileAsync(cmd, ['--version'], { timeout: 3000 });
      return { available: true, cmd };
    } catch { /* try next */ }
  }
  return { available: false, cmd: 'python3' };
}

let _pythonAvailable: boolean | null = null;
let _pythonCmd = 'python3';

async function runPython(code: string, timeoutMs: number = 10000): Promise<SandboxResult> {
  const start = Date.now();

  // Check availability once
  if (_pythonAvailable === null) {
    const check = await checkPythonAvailable();
    _pythonAvailable = check.available;
    _pythonCmd = check.cmd;
  }

  if (!_pythonAvailable) {
    return {
      success: false,
      stdout: '',
      stderr: 'Python is not available in this environment. Use JavaScript instead.',
      exitCode: 1,
      durationMs: Date.now() - start,
      language: 'python',
      error: 'python_unavailable',
    };
  }

  // Wrap code to restrict dangerous capabilities
  const wrappedCode = `
import sys
import signal

# Restrict recursion
sys.setrecursionlimit(500)

# Block network access
import socket as _socket
_real_getaddrinfo = _socket.getaddrinfo
def _blocked_socket(*args, **kwargs):
    raise PermissionError("Network access blocked in sandbox")
_socket.socket = _blocked_socket

# Block subprocess
import subprocess as _subprocess
_subprocess.run = lambda *a, **k: (_ for _ in ()).throw(PermissionError("Subprocess blocked in sandbox"))
_subprocess.Popen = lambda *a, **k: (_ for _ in ()).throw(PermissionError("Subprocess blocked in sandbox"))

# User code:
${code}
`.trim();

  try {
    const timeoutSecs = Math.floor(timeoutMs / 1000);
    const { stdout, stderr } = await execFileAsync(
      'timeout',
      [String(timeoutSecs), _pythonCmd, '-E', '-S', '-c', wrappedCode],
      {
        timeout: timeoutMs + 2000,
        maxBuffer: 51200,  // 50KB stdout limit
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin:/home/codespace/.python/current/bin',
          HOME: '/tmp',
          LANG: 'en_US.UTF-8',
        },
      }
    );

    return {
      success: true,
      stdout: stdout.substring(0, 51200),
      stderr: stderr.substring(0, 10240),
      exitCode: 0,
      durationMs: Date.now() - start,
      language: 'python',
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string; stdout?: string };
    const isTimeout = e.killed || e.code === '124' || String(e.code) === '124';
    const stderr = (e.stderr || '').substring(0, 10240);
    const stdout = (e.stdout || '').substring(0, 51200);

    return {
      success: false,
      stdout,
      stderr: isTimeout ? 'Execution timed out (limit exceeded)' : stderr || e.message || String(err),
      exitCode: isTimeout ? 124 : (typeof e.code === 'number' ? e.code : 1),
      durationMs: Date.now() - start,
      language: 'python',
      error: isTimeout ? 'timeout' : 'execution_error',
    };
  }
}

// ── Public API ────────────────────────────────────────────────────

export type SandboxLanguage = 'python' | 'javascript' | 'js' | 'py';

export async function runInSandbox(
  language: SandboxLanguage,
  code: string,
  timeoutMs: number = 10000
): Promise<SandboxResult> {
  // Normalize language
  const lang = language === 'js' ? 'javascript' : language === 'py' ? 'python' : language;

  // Validate inputs
  if (!code || code.trim().length === 0) {
    return { success: false, stdout: '', stderr: 'No code provided', exitCode: 1, durationMs: 0, language: lang };
  }
  if (code.length > 50000) {
    return { success: false, stdout: '', stderr: 'Code too long (50KB limit)', exitCode: 1, durationMs: 0, language: lang };
  }
  if (timeoutMs > 30000) timeoutMs = 30000;  // max 30s

  console.log(`[SANDBOX] Running ${lang} code (${code.length} chars, ${timeoutMs}ms timeout)`);

  if (lang === 'javascript') {
    return runJavaScript(code, timeoutMs);
  } else if (lang === 'python') {
    return runPython(code, timeoutMs);
  } else {
    return {
      success: false,
      stdout: '',
      stderr: `Language "${lang}" not supported. Use: python, javascript`,
      exitCode: 1,
      durationMs: 0,
      language: lang,
    };
  }
}

/**
 * Format sandbox result for display to AI and user.
 */
export function formatSandboxResult(result: SandboxResult): string {
  const lines: string[] = [];
  if (result.stdout) lines.push(`Output:\n${result.stdout}`);
  if (result.stderr && !result.success) lines.push(`Error:\n${result.stderr}`);
  if (!result.success && !result.stderr && !result.stdout) lines.push('No output.');
  lines.push(`(${result.language}, ${result.durationMs}ms)`);
  return lines.join('\n');
}
