import { spawn } from 'node:child_process'

export type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export class CommandError extends Error {
  readonly command: string
  readonly exitCode: number | null
  readonly stderr: string
  readonly timedOut: boolean

  constructor(input: { command: string; exitCode: number | null; stderr: string; timedOut: boolean; cause?: unknown }) {
    super(`${input.command} failed${input.exitCode == null ? '' : ` with exit code ${input.exitCode}`}`, { cause: input.cause })
    this.name = 'CommandError'
    this.command = input.command
    this.exitCode = input.exitCode
    this.stderr = input.stderr
    this.timedOut = input.timedOut
  }
}

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAX_CAPTURE_BYTES) return current
  return (current + chunk.toString('utf8')).slice(0, MAX_CAPTURE_BYTES)
}

export function runCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = { timeoutMs: 120_000 },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const terminate = () => {
      if (child.exitCode != null) return
      child.kill('SIGTERM')
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      killTimer.unref()
    }
    const onAbort = () => terminate()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      terminate()
    }, options.timeoutMs)
    timeout.unref()

    child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (cause) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      reject(new CommandError({ command: executable, exitCode: null, stderr, timedOut, cause }))
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      if (exitCode === 0 && !timedOut && !options.signal?.aborted) {
        resolve({ stdout, stderr, exitCode: 0 })
      } else {
        reject(new CommandError({ command: executable, exitCode, stderr, timedOut }))
      }
    })
  })
}

export async function checkRuntimeDependencies(signal?: AbortSignal): Promise<Record<string, string>> {
  const commands: Array<[string, string[]]> = [
    ['qpdf', ['--version']],
    ['pdfinfo', ['-v']],
    ['pdftotext', ['-v']],
    ['pdfimages', ['-v']],
    ['pdftocairo', ['-v']],
    ['ocrmypdf', ['--version']],
    ['tesseract', ['--version']],
  ]
  const versions: Record<string, string> = {}
  for (const [command, args] of commands) {
    const result = await runCommand(command, args, { timeoutMs: 30_000, signal })
    versions[command] = (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim() || 'available'
  }
  return versions
}
