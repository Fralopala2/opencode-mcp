import type { Agent, PromptPart, ServerEvent, Session, SessionMessage } from './types';

export interface HttpClientOptions {
    baseUrl: string;
    authHeaders: Record<string, string>;
    directory?: string;
}

export class HttpOpenCodeClient {
    constructor(private readonly options: HttpClientOptions) {}

    private url(path: string, query?: Record<string, string | undefined>): string {
        const base = this.options.baseUrl.replace(/\/$/, '');
        const u = new URL(`${base}${path}`);
        if (this.options.directory) {
            u.searchParams.set('directory', this.options.directory);
        }
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v !== undefined) {
                    u.searchParams.set(k, v);
                }
            }
        }
        return u.toString();
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {
        const response = await fetch(this.url(path), {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...this.options.authHeaders,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(
                `OpenCode ${method} ${path}: ${response.status} ${text}`.trim()
            );
        }
        if (response.status === 204) {
            return undefined as T;
        }
        return (await response.json()) as T;
    }

    async health(): Promise<{ healthy: boolean; version?: string }> {
        try {
            const response = await fetch(this.url('/global/health'), {
                headers: this.options.authHeaders,
            });
            if (!response.ok) {
                return { healthy: false };
            }
            const body = (await response.json()) as {
                healthy?: boolean;
                version?: string;
            };
            return { healthy: body.healthy === true, version: body.version };
        } catch {
            return { healthy: false };
        }
    }

    async createSession(title: string): Promise<Session> {
        return this.request<Session>('POST', '/session', { title });
    }

    async getSession(id: string): Promise<Session | undefined> {
        try {
            return await this.request<Session>('GET', `/session/${id}`);
        } catch {
            return undefined;
        }
    }

    async listAgents(): Promise<Agent[]> {
        return this.request<Agent[]>('GET', '/agent');
    }

    async listSessions(): Promise<Session[]> {
        return this.request<Session[]>('GET', '/session');
    }

    async listProviders(): Promise<any> {
        return this.request<any>('GET', '/provider');
    }

    async listModels(): Promise<{ id: string; name: string }[]> {
        try {
            const data = await this.request<any>('GET', '/provider');
            const connected = data.connected || [];
            const result: { id: string; name: string }[] = [];
            for (const p of data.all || []) {
                if (connected.includes(p.id)) {
                    const modelsArray = p.models ? Object.values(p.models) : [];
                    for (const m of modelsArray as any[]) {
                        result.push({
                            id: `${p.id}::${m.id}`,
                            name: `${p.name} - ${m.name || m.id}`
                        });
                    }
                }
            }
            return result;
        } catch {
            return [];
        }
    }

    async promptAsync(
        sessionId: string,
        body: { agent?: string; model?: any; parts: PromptPart[] }
    ): Promise<void> {
        await this.request<void>('POST', `/session/${sessionId}/prompt_async`, body);
    }

    async listMessages(sessionId: string): Promise<SessionMessage[]> {
        return this.request<SessionMessage[]>('GET', `/session/${sessionId}/message`);
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request<void>('POST', `/session/${sessionId}/abort`);
    }

    async respondPermission(
        sessionId: string,
        permissionId: string,
        response: 'once' | 'always' | 'reject'
    ): Promise<void> {
        await this.request<void>(
            'POST',
            `/session/${sessionId}/permissions/${permissionId}`,
            { response }
        );
    }

    subscribeEvents(
        onEvent: (event: ServerEvent) => void,
        signal: AbortSignal
    ): Promise<void> {
        const url = this.url('/event');
        return this.consumeSse(url, onEvent, signal);
    }

    private async consumeSse(
        url: string,
        onEvent: (event: ServerEvent) => void,
        signal: AbortSignal
    ): Promise<void> {
        const response = await fetch(url, {
            headers: {
                Accept: 'text/event-stream',
                ...this.options.authHeaders,
            },
            signal,
        });
        if (!response.ok || !response.body) {
            throw new Error(`SSE /event: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() ?? '';
            for (const chunk of chunks) {
                const dataLine = chunk
                    .split('\n')
                    .find((l) => l.startsWith('data:'));
                if (!dataLine) {
                    continue;
                }
                const json = dataLine.replace(/^data:\s*/, '');
                if (!json || json === '[DONE]') {
                    continue;
                }
                try {
                    onEvent(JSON.parse(json) as ServerEvent);
                } catch {
                    // ignorar líneas mal formadas
                }
            }
        }
    }
}
