import type { FilePartInput, Part, PromptPart, TextPartInput } from './types';
import * as path from 'path';

export type { PromptPart, TextPartInput, FilePartInput };

export function pathToFileUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
        return `file:///${normalized}`;
    }
    if (normalized.startsWith('/')) {
        return `file://${normalized}`;
    }
    return `file:///${normalized}`;
}

export function guessMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
        '.ts': 'text/typescript',
        '.tsx': 'text/typescript',
        '.js': 'text/javascript',
        '.jsx': 'text/javascript',
        '.json': 'application/json',
        '.md': 'text/markdown',
        '.html': 'text/html',
        '.css': 'text/css',
        '.py': 'text/x-python',
        '.rs': 'text/x-rust',
        '.go': 'text/x-go',
        '.java': 'text/x-java',
        '.xml': 'application/xml',
        '.yaml': 'text/yaml',
        '.yml': 'text/yaml',
    };
    return map[ext] ?? 'text/plain';
}

export function buildFilePart(
    filePath: string,
    content: string,
    label?: string
): TextPartInput {
    const filename = label ?? path.basename(filePath);
    return {
        type: 'text',
        text: `Archivo: ${filename}\n\`\`\`\n${content}\n\`\`\``
    };
}

export function buildSelectionPart(
    filePath: string,
    content: string,
    startLine: number,
    endLine: number
): TextPartInput {
    const lines = content.split(/\r?\n/);
    const snippet = lines.slice(startLine, endLine + 1).join('\n');
    const filename = `${path.basename(filePath)}:${startLine + 1}-${endLine + 1}`;
    return {
        type: 'text',
        text: `Fragmento: ${filename}\n\`\`\`\n${snippet}\n\`\`\``
    };
}

export function partsToDisplayText(parts: Part[]): string {
    const chunks: string[] = [];
    for (const part of parts) {
        switch (part.type) {
            case 'text':
                if (part.text.trim()) {
                    chunks.push(part.text);
                }
                break;
            case 'reasoning':
                if (part.text.trim()) {
                    chunks.push(`_${part.text}_`);
                }
                break;
            case 'tool': {
                const state = part.state;
                if (state.status === 'completed') {
                    chunks.push(`**Tool ${part.tool}:** ${state.title ?? state.output}`);
                } else if (state.status === 'error') {
                    chunks.push(`**Tool ${part.tool} (error):** ${state.error}`);
                }
                break;
            }
            case 'call': {
                chunks.push(`⚙️ *Llamando a herramienta:* \`${part.tool || 'desconocida'}\``);
                break;
            }
            default:
                break;
        }
    }
    const text = chunks.join('\n\n').trim();
    if (!text && parts.length > 0) {
        return '';
    }
    return text || '(sin contenido de texto)';
}

export function contextLabel(part: PromptPart): string {
    if (part.type === 'file' && part.filename) {
        return part.filename;
    }
    if (part.type === 'text') {
        if (part.text.startsWith('Archivo: ') || part.text.startsWith('Fragmento: ')) {
            return part.text.split('\n')[0].replace(/^(Archivo|Fragmento): /, '');
        }
        const preview = part.text.slice(0, 40).replace(/\s+/g, ' ');
        return preview.length < part.text.length ? `${preview}…` : preview;
    }
    return (part as any).url ?? 'Adjunto';
}
