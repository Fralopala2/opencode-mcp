import * as vscode from 'vscode';
import { HttpOpenCodeClient } from './httpClient';
import { partsToDisplayText, type PromptPart } from './parts';
import { startOpencodeServer, type ManagedServer } from './serverProcess';
import { getOpenCodeSettings, getWorkspaceDirectory } from './settings';
import type { Agent, ServerEvent, Session, SessionMessage } from './types';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface StreamUpdate {
    sessionId: string;
    text: string;
    done: boolean;
    error?: string;
    metrics?: { input: number; output: number };
}

export class OpenCodeService implements vscode.Disposable {
    private static extensionContext: vscode.ExtensionContext | undefined;

    private client: HttpOpenCodeClient | undefined;
    private managedServer: ManagedServer | undefined;
    private sessionId: string | undefined;
    private connectionState: ConnectionState = 'disconnected';
    private eventAbort: AbortController | undefined;
    private readonly streamListeners = new Set<(update: StreamUpdate) => void>();
    private readonly statusListeners = new Set<
        (state: ConnectionState, detail?: string) => void
    >();
    private activeStream = new Map<string, string>();
    private sessionTimeout: NodeJS.Timeout | undefined;
    private readonly TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos

    private resetTimeout(sessionId: string): void {
        this.clearTimeout();
        this.sessionTimeout = setTimeout(() => {
            void this.handleTimeout(sessionId);
        }, this.TIMEOUT_MS);
    }

    private clearTimeout(): void {
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
            this.sessionTimeout = undefined;
        }
    }

    private async handleTimeout(sessionId: string): Promise<void> {
        await this.abortSession(true);
        this.emitStream({
            sessionId,
            text: '',
            done: true,
            error: 'La petición tardó demasiado y fue cancelada automáticamente (timeout de 3m).'
        });
    }

    onStream(listener: (update: StreamUpdate) => void): vscode.Disposable {
        this.streamListeners.add(listener);
        return new vscode.Disposable(() => this.streamListeners.delete(listener));
    }

    onStatus(listener: (state: ConnectionState, detail?: string) => void): vscode.Disposable {
        this.statusListeners.add(listener);
        listener(this.connectionState);
        return new vscode.Disposable(() => this.statusListeners.delete(listener));
    }

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    private setStatus(state: ConnectionState, detail?: string): void {
        this.connectionState = state;
        for (const listener of this.statusListeners) {
            listener(state, detail);
        }
    }

    private emitStream(update: StreamUpdate): void {
        for (const listener of this.streamListeners) {
            listener(update);
        }
    }

    private workspaceKey(): string {
        const dir = getWorkspaceDirectory();
        return dir ? dir.toLowerCase() : 'global';
    }

    persistSelectedModel(model: string): void {
        const key = `model.${this.workspaceKey()}`;
        void OpenCodeService.extensionContext?.workspaceState.update(key, model);
    }

    getSelectedModel(): string | undefined {
        const key = `model.${this.workspaceKey()}`;
        return OpenCodeService.extensionContext?.workspaceState.get<string>(key);
    }

    private persistSessionId(sessionId: string): void {
        this.sessionId = sessionId;
        const key = `session.${this.workspaceKey()}`;
        void OpenCodeService.extensionContext?.workspaceState.update(key, sessionId);
    }

    private getAuthHeaders(): Record<string, string> {
        const settings = getOpenCodeSettings();
        if (!settings.serverPassword) {
            return {};
        }
        const token = Buffer.from(
            `${settings.serverUsername}:${settings.serverPassword}`,
            'utf8'
        ).toString('base64');
        return { Authorization: `Basic ${token}` };
    }

    private buildClient(baseUrl: string): HttpOpenCodeClient {
        return new HttpOpenCodeClient({
            baseUrl,
            authHeaders: this.getAuthHeaders(),
            directory: getWorkspaceDirectory(),
        });
    }

    async connect(): Promise<void> {
        const settings = getOpenCodeSettings();
        this.setStatus('connecting');

        try {
            let baseUrl = settings.serverUrl.replace(/\/$/, '');
            this.client = this.buildClient(baseUrl);
            let health = await this.client.health();

            if (!health.healthy && settings.autoStartServer) {
                this.managedServer?.close();
                const cwd = getWorkspaceDirectory();
                this.managedServer = await startOpencodeServer(settings.serverPort, cwd);
                baseUrl = this.managedServer.url.replace(/\/$/, '');
                this.client = this.buildClient(baseUrl);
                health = await this.client.health();
            }

            if (!health.healthy) {
                throw new Error(
                    'OpenCode no responde. Ejecuta `opencode serve` o activa opencode.autoStartServer.'
                );
            }

            await this.ensureSession();
            void this.startEventSubscription();
            this.setStatus('connected', health.version);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus('error', message);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        this.clearTimeout();
        this.eventAbort?.abort();
        this.eventAbort = undefined;
        this.managedServer?.close();
        this.managedServer = undefined;
        this.client = undefined;
        this.setStatus('disconnected');
    }

    async reconnect(): Promise<void> {
        await this.disconnect();
        await this.connect();
    }

    private async ensureSession(): Promise<string> {
        if (!this.client) {
            throw new Error('Cliente no inicializado');
        }

        const storageKey = `session.${this.workspaceKey()}`;
        const existingId =
            this.sessionId ??
            OpenCodeService.extensionContext?.workspaceState.get<string>(storageKey);

        if (existingId) {
            const session = await this.client.getSession(existingId);
            if (session?.id) {
                this.persistSessionId(existingId);
                return existingId;
            }
        }

        const title =
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'OpenCode VS Code';
        const created = await this.client.createSession(`${title} (VS Code)`);
        this.persistSessionId(created.id);
        return created.id;
    }

    async initialize(context: vscode.ExtensionContext): Promise<void> {
        OpenCodeService.extensionContext = context;
        const storageKey = `session.${this.workspaceKey()}`;
        this.sessionId = context.workspaceState.get<string>(storageKey);
        try {
            await this.connect();
        } catch {
            // El panel permite reconectar manualmente.
        }
    }

    async newSession(): Promise<string> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            throw new Error('Sin conexión');
        }

        const title =
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'OpenCode VS Code';
        const created = await this.client.createSession(`${title} (VS Code)`);
        this.persistSessionId(created.id);
        return created.id;
    }

    async abortSession(silent: boolean = false): Promise<void> {
        this.clearTimeout();
        if (!this.client || !this.sessionId) {
            return;
        }
        await this.client.abortSession(this.sessionId);
        this.activeStream.delete(this.sessionId);
        if (!silent) {
            this.emitStream({
                sessionId: this.sessionId,
                text: '',
                done: true,
            });
        }
    }

    async listSessions(): Promise<Session[]> {
        if (!this.client) {
            return [];
        }
        return this.client.listSessions();
    }

    async listMessages(sessionId: string): Promise<SessionMessage[]> {
        if (!this.client) {
            return [];
        }
        return this.client.listMessages(sessionId);
    }

    async selectSession(sessionId: string): Promise<void> {
        this.persistSessionId(sessionId);
        void this.startEventSubscription();
    }

    async listAgents(): Promise<Agent[]> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            return [];
        }
        return this.client.listAgents();
    }

    async listModels(): Promise<{ id: string; name: string }[]> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            return [];
        }
        return this.client.listModels();
    }

    async sendPrompt(
        text: string,
        agent: string | undefined,
        model: string | undefined,
        contextParts: PromptPart[],
        attachments: PromptPart[] = []
    ): Promise<void> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            throw new Error('Sin conexión a OpenCode');
        }

        const sessionId = await this.ensureSession();
        const settings = getOpenCodeSettings();
        const selectedAgent = agent || settings.defaultAgent || undefined;

        const parts: PromptPart[] = [...contextParts, ...attachments, { type: 'text', text }];

        this.activeStream.set(sessionId, '');

        let parsedModel: { providerID: string, modelID: string } | undefined;
        if (model) {
            const split = model.split('::');
            if (split.length === 2) {
                parsedModel = { providerID: split[0], modelID: split[1] };
            }
        }

        try {
            this.resetTimeout(sessionId);
            await this.client.promptAsync(sessionId, {
                agent: selectedAgent,
                model: parsedModel,
                parts,
            });
        } catch (error) {
            this.clearTimeout();
            const message = error instanceof Error ? error.message : String(error);
            this.emitStream({
                sessionId,
                text: '',
                done: true,
                error: message,
            });
            throw error;
        }
    }

    private async startEventSubscription(): Promise<void> {
        if (!this.client) {
            return;
        }
        this.eventAbort?.abort();
        this.eventAbort = new AbortController();
        const signal = this.eventAbort.signal;

        try {
            this.client.subscribeEvents(
                (event) => {
                    void this.handleEvent(event);
                },
                signal
            );
        } catch (error) {
            if (signal.aborted) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus('error', `Event stream: ${message}`);
        }
    }
    private async handleEvent(event: ServerEvent): Promise<void> {
        const sessionId = this.sessionId;
        if (!sessionId || !this.client) {
            return;
        }

        this.resetTimeout(sessionId);

        if (event.type === 'message.part.updated') {
            const props = event.properties as {
                part?: { sessionID?: string; type?: string; text?: string; messageID?: string; tool?: string; state?: any };
                delta?: string;
            } | undefined;
            if (props?.part?.sessionID !== sessionId || !props.part.messageID) {
                return;
            }

            if (props.part.type === 'text' || props.part.type === 'reasoning') {
                const prev = this.activeStream.get(sessionId) ?? '';
                const next =
                    props.delta !== undefined
                        ? prev + props.delta
                        : (props.part.text ?? prev);
                this.activeStream.set(sessionId, next);
                this.emitStream({ sessionId, text: next, done: false });
            } else if (props.part.type === 'call') {
                const toolName = props.part.tool || 'herramienta';
                const prev = this.activeStream.get(sessionId) ?? '';
                const indicator = `\n> ⚙️ Ejecutando: \`${toolName}\`...\n`;
                if (!prev.includes(indicator)) {
                    const next = prev + indicator;
                    this.activeStream.set(sessionId, next);
                    this.emitStream({ sessionId, text: next, done: false });
                }
            } else if (props.part.type === 'tool') {
                const toolName = props.part.tool || 'herramienta';
                const prev = this.activeStream.get(sessionId) ?? '';
                const status = props.part.state?.status === 'error' ? '❌ Error en' : '✅ Completado:';
                const indicator = `\n> ${status} \`${toolName}\`\n`;
                if (!prev.includes(indicator)) {
                    const next = prev + indicator;
                    this.activeStream.set(sessionId, next);
                    this.emitStream({ sessionId, text: next, done: false });
                }
            }
        }

        if (event.type === 'session.idle') {
            const props = event.properties as { sessionID?: string; error?: any } | undefined;
            if (props?.sessionID !== sessionId) {
                return;
            }
            const messages = await this.client.listMessages(sessionId);
            const lastAssistant = [...messages]
                .reverse()
                .find((m) => m.info.role === 'assistant');
            
            const text = lastAssistant
                ? partsToDisplayText(lastAssistant.parts)
                : '';
                
            this.clearTimeout();
            this.activeStream.delete(sessionId);
            
            if (props?.error) {
                const errMsg = props.error?.data?.message || props.error?.name || 'Error del agente';
                this.emitStream({ sessionId, text: '', done: true, error: errMsg });
            } else if (lastAssistant?.info?.error) {
                const errorObj = lastAssistant.info.error;
                const errMsg = errorObj.data?.message || errorObj.message || errorObj.name || 'Error del proveedor';
                this.emitStream({ sessionId, text: '', done: true, error: errMsg });
            } else {
                this.emitStream({ sessionId, text, done: true, metrics: lastAssistant?.info?.tokens });
            }
        }

        if (event.type === 'permission.updated') {
            await this.handlePermission(event.properties);
        }
    }

    private async handlePermission(permission: unknown): Promise<void> {
        if (!this.client) {
            return;
        }
        const perm = permission as {
            id: string;
            sessionID: string;
            title: string;
        };
        const settings = getOpenCodeSettings();

        if (settings.autoApprovePermissions) {
            await this.client.respondPermission(perm.sessionID, perm.id, 'always');
            return;
        }

        const choice = await vscode.window.showWarningMessage(
            `OpenCode: ${perm.title}`,
            'Permitir',
            'Denegar'
        );
        if (!choice) {
            return;
        }
        await this.client.respondPermission(
            perm.sessionID,
            perm.id,
            choice === 'Permitir' ? 'once' : 'reject'
        );
    }

    dispose(): void {
        void this.disconnect();
    }
}
