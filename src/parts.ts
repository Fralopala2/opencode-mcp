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
): FilePartInput {
    return {
        type: 'file',
        mime: guessMime(filePath),
        filename: label ?? path.basename(filePath),
        url: pathToFileUrl(filePath),
        source: {
            type: 'file',
            path: filePath,
            text: { value: content, start: 0, end: content.length },
        },
    };
}

export function buildSelectionPart(
    filePath: string,
    content: string,
    startLine: number,
    endLine: number
): FilePartInput {
    const lines = content.split(/\r?\n/);
    const snippet = lines.slice(startLine, endLine + 1).join('\n');
    return {
        type: 'file',
        mime: guessMime(filePath),
        filename: `${path.basename(filePath)}:${startLine + 1}-${endLine + 1}`,
        url: pathToFileUrl(filePath),
        source: {
            type: 'symbol',
            path: filePath,
            name: path.basename(filePath),
            kind: 0,
            range: {
                start: { line: startLine, character: 0 },
                end: { line: endLine, character: lines[endLine]?.length ?? 0 },
            },
            text: { value: snippet, start: 0, end: snippet.length },
        },
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
            default:
                break;
        }
    }
    return chunks.join('\n\n').trim() || '(sin contenido de texto)';
}

export function contextLabel(part: PromptPart): string {
    if (part.type === 'text') {
        const preview = part.text.slice(0, 40).replace(/\s+/g, ' ');
        return preview.length < part.text.length ? `${preview}…` : preview;
    }
    return part.filename ?? part.url;
}
