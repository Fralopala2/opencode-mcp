import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getOpenCodeSettings } from './settings';

function getSettingsBin(): string {
    try {
        return getOpenCodeSettings().opencodeBin;
    } catch {
        return '';
    }
}

export interface ManagedServer {
    url: string;
    close(): void;
}

function resolveOpencodeExecutable(): { command: string; spawnOptions?: SpawnOptions } {
    const settingsBin = getSettingsBin();
    const envBin = settingsBin || process.env.OPENCODE_BIN;
    if (envBin && fs.existsSync(envBin)) {
        return { command: envBin };
    }

    if (process.platform === 'win32') {
        const appData = process.env.APPDATA;
        if (appData) {
            const exe = path.join(
                appData,
                'npm',
                'node_modules',
                'opencode-ai',
                'bin',
                'opencode.exe'
            );
            if (fs.existsSync(exe)) {
                return { command: exe };
            }
            const cmd = path.join(appData, 'npm', 'opencode.cmd');
            if (fs.existsSync(cmd)) {
                return { command: cmd, spawnOptions: { shell: true } };
            }
        }
        return { command: 'opencode', spawnOptions: { shell: true } };
    }

    return { command: 'opencode' };
}

export async function startOpencodeServer(
    port: number,
    hostname = '127.0.0.1',
    timeoutMs = 20000
): Promise<ManagedServer> {
    const args = ['serve', `--hostname=${hostname}`, `--port=${port}`];
    const { command, spawnOptions } = resolveOpencodeExecutable();

    const proc = spawn(command, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...spawnOptions,
    });

    const url = await waitForServerUrl(proc, timeoutMs);

    return {
        url,
        close: () => stopProcess(proc),
    };
}

function waitForServerUrl(proc: ChildProcess, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let output = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                reject(new Error(`Timeout esperando opencode serve (${timeoutMs}ms)`));
            }
        }, timeoutMs);

        const onData = (chunk: Buffer) => {
            if (settled) {
                return;
            }
            output += chunk.toString();
            for (const line of output.split('\n')) {
                if (line.includes('opencode server listening')) {
                    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
                    if (match) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(match[1]);
                        return;
                    }
                }
            }
        };

        const cleanup = () => {
            proc.stdout?.off('data', onData);
            proc.stderr?.off('data', onData);
        };

        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(
                    new Error(
                        `${err.message}. Asegúrate de que opencode está en PATH o define OPENCODE_BIN.`
                    )
                );
            }
        });
        proc.on('exit', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(
                    new Error(
                        `opencode serve terminó con código ${code}. ${output}`.trim()
                    )
                );
            }
        });
    });
}

function stopProcess(proc: ChildProcess): void {
    if (!proc.killed) {
        proc.kill();
    }
}
