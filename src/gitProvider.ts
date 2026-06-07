import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitInfo {
    branch: string;
    commits: string[];
    status: string;
    repoPath: string;
    hasChanges: boolean;
}

export class GitProvider {
    private gitInfo: GitInfo | null = null;

    /**
     * Verifica si el directorio actual es un repositorio Git
     */
    async isGitRepo(cwd: string): Promise<boolean> {
        try {
            await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Obtiene el nombre de la rama actual
     */
    async getCurrentBranch(cwd: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['rev-parse', '--abbrev-ref', 'HEAD'],
                { cwd }
            );
            return stdout.trim();
        } catch (error) {
            throw new Error(`No se pudo obtener la rama actual: ${error}`);
        }
    }

    /**
     * Obtiene los últimos commits (últimos 5)
     */
    async getRecentCommits(cwd: string, limit: number = 5): Promise<string[]> {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['log', `-${limit}`, '--oneline'],
                { cwd }
            );
            return stdout
                .trim()
                .split('\n')
                .filter((line) => line.length > 0);
        } catch (error) {
            return [];
        }
    }

    /**
     * Obtiene el estado del repositorio (archivos modificados, staged, etc.)
     */
    async getStatus(cwd: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['status', '--short'],
                { cwd }
            );
            return stdout.trim();
        } catch (error) {
            return '';
        }
    }

    /**
     * Verifica si hay cambios en el repositorio
     */
    async hasUncommittedChanges(cwd: string): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['status', '--porcelain'],
                { cwd }
            );
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Obtiene la ruta raíz del repositorio Git
     */
    async getRepoRoot(cwd: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['rev-parse', '--show-toplevel'],
                { cwd }
            );
            return stdout.trim();
        } catch (error) {
            throw new Error(`No se pudo obtener la ruta del repositorio: ${error}`);
        }
    }

    /**
     * Obtiene toda la información de Git formateada
     */
    async getGitInfo(cwd: string): Promise<GitInfo | null> {
        try {
            // Verificar si es un repositorio Git
            const isRepo = await this.isGitRepo(cwd);
            if (!isRepo) {
                return null;
            }

            // Obtener la ruta del repositorio
            const repoPath = await this.getRepoRoot(cwd);

            // Obtener todas las información en paralelo
            const [branch, commits, status, hasChanges] = await Promise.all([
                this.getCurrentBranch(repoPath),
                this.getRecentCommits(repoPath),
                this.getStatus(repoPath),
                this.hasUncommittedChanges(repoPath),
            ]);

            this.gitInfo = {
                branch,
                commits,
                status,
                repoPath,
                hasChanges,
            };

            return this.gitInfo;
        } catch (error) {
            console.error('Error al obtener información de Git:', error);
            return null;
        }
    }

    /**
     * Formatea la información de Git como un string legible
     */
    formatGitInfo(gitInfo: GitInfo): string {
        let output = '📦 **Información de Git**\n\n';

        // Rama actual
        output += `**Branch**: \`${gitInfo.branch}\`\n`;

        // Estado de cambios
        if (gitInfo.hasChanges) {
            output += `**Estado**: ⚠️ Tiene cambios sin confirmar\n`;
        } else {
            output += `**Estado**: ✅ Líimpiio (sin cambios)\n`;
        }

        // Ruta del repositorio
        output += `**Ruta**: \`${gitInfo.repoPath}\`\n\n`;

        // Últimos commits
        if (gitInfo.commits.length > 0) {
            output += `**Últimos ${gitInfo.commits.length} commits**:\n`;
            gitInfo.commits.forEach((commit) => {
                output += `  - ${commit}\n`;
            });
            output += '\n';
        }

        // Estado de archivos
        if (gitInfo.status) {
            output += `**Archivos modificados**:\n`;
            const lines = gitInfo.status.split('\n');
            const maxLines = 10;
            lines.slice(0, maxLines).forEach((line) => {
                // Formatear el estado de Git
                const status = line.slice(0, 2);
                const file = line.slice(3);
                const statusIcon = this.getStatusIcon(status);
                output += `  ${statusIcon} \`${file}\`\n`;
            });
            if (lines.length > maxLines) {
                output += `  ... y ${lines.length - maxLines} archivo(s) más\n`;
            }
        } else {
            output += `**Archivos modificados**: Ninguno\n`;
        }

        return output;
    }

    /**
     * Obtiene un icono basado en el estado de Git
     */
    private getStatusIcon(status: string): string {
        const staged = status[0];
        const unstaged = status[1];

        if (staged === 'D' || unstaged === 'D') return '🗑️';
        if (staged === 'A' || unstaged === 'A') return '➕';
        if (staged === 'M' || unstaged === 'M') return '✏️';
        if (staged === 'R') return '🔄';
        if (staged === 'C') return '📋';
        if (unstaged === '?') return '❓';

        return '📝';
    }

    /**
     * Formatea solo el resumen de Git (branch y estado)
     */
    formatGitSummary(gitInfo: GitInfo): string {
        const statusIcon = gitInfo.hasChanges ? '⚠️' : '✅';
        return `${statusIcon} \`${gitInfo.branch}\` | ${gitInfo.commits.length} commits | ${gitInfo.hasChanges ? 'con cambios' : 'limpio'}`;
    }

    /**
     * Limpia la información cacheada
     */
    clearCache(): void {
        this.gitInfo = null;
    }

    /**
     * Obtiene la información de Git cacheada
     */
    getCachedInfo(): GitInfo | null {
        return this.gitInfo;
    }
}

// Singleton instance
export const gitProvider = new GitProvider();