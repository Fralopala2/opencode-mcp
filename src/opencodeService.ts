import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAuthPath } from './settings';
import { HttpOpenCodeClient } from './httpClient';
import { partsToDisplayText, type PromptPart } from './parts';
import { startOpencodeServer, type ManagedServer } from './serverProcess';
import { getOpenCodeSettings, getWorkspaceDirectory } from './settings';
import type { Agent, ServerEvent, Session, SessionMessage } from './types';

const execPromise = promisify(exec);

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface StreamUpdate {
    sessionId: string;
    text: string;
    done: boolean;
    error?: string;
    metrics?: { input: number; output: number };
    statusDetail?: string;
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
    private pendingPrompts = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
    private sessionTimeout: NodeJS.Timeout | undefined;
    private readonly TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 3;

    private lastPromptInfo: {
        text: string;
        agent: string | undefined;
        model: string | undefined;
        contextParts: PromptPart[];
        attachments: PromptPart[];
    } | undefined;
    private failoverIndices: Map<string, number> = new Map();

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
        if (!this.activeStream.has(sessionId)) {
            return;
        }
        const text = this.activeStream.get(sessionId) ?? '';
        this.activeStream.delete(sessionId);
        this.abortSession(true).catch(err => {
            console.error('[Timeout] Error al abortar la sesión:', err);
        });
        this.emitStream({
            sessionId,
            text,
            done: true,
            error: 'La petición tardó demasiado y fue cancelada automáticamente (timeout de 3m).',
            statusDetail: 'Timeout de 3 minutos alcanzado.'
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
        if (update.done) {
            const pending = this.pendingPrompts.get(update.sessionId);
            if (pending) {
                this.pendingPrompts.delete(update.sessionId);
                if (update.error) {
                    pending.reject(new Error(update.error));
                } else {
                    pending.resolve();
                }
            }
        }
    }

    private workspaceKey(): string {
        const dir = getWorkspaceDirectory();
        return dir ? dir.toLowerCase() : 'global';
    }

    persistSelectedModel(model: string): void {
        const key = `model.${this.workspaceKey()}`;
        void OpenCodeService.extensionContext?.globalState.update(key, model || undefined);
    }

    getSelectedModel(): string | undefined {
        const key = `model.${this.workspaceKey()}`;
        return OpenCodeService.extensionContext?.globalState.get<string>(key);
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
            this.reconnectAttempts = 0;
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
        this.lastPromptInfo = undefined;
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
        attachments: PromptPart[] = [],
        isFailover: boolean = false
    ): Promise<void> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            throw new Error('Sin conexión a OpenCode');
        }

        if (!isFailover) {
            this.lastPromptInfo = { text, agent, model, contextParts, attachments };
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
            this.emitStream({
                sessionId,
                text: '',
                done: false,
                statusDetail: 'Enviando petición...'
            });
            await this.client.promptAsync(sessionId, {
                agent: selectedAgent,
                model: parsedModel,
                parts,
            });

            return new Promise<void>((resolve, reject) => {
                this.pendingPrompts.set(sessionId, { resolve, reject });
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

    private async connectSilent(): Promise<void> {
        const settings = getOpenCodeSettings();
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
            throw new Error('OpenCode no responde.');
        }

        await this.ensureSession();
        this.setStatus('connected', health.version);
    }

    private async startEventSubscription(): Promise<void> {
        if (!this.client) {
            return;
        }
        this.eventAbort?.abort();
        this.eventAbort = new AbortController();
        const signal = this.eventAbort.signal;

        try {
            await this.client.subscribeEvents(
                (event) => {
                    this.reconnectAttempts = 0;
                    void this.handleEvent(event);
                },
                signal
            );
            if (!signal.aborted) {
                throw new Error('La conexión al servidor se cerró.');
            }
        } catch (error) {
            if (signal.aborted) {
                return;
            }
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.pow(2, this.reconnectAttempts) * 1000;
                console.log(`[Reconexión] Conexión perdida. Reintentando en ${delay}ms... (Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                await new Promise((r) => setTimeout(r, delay));
                if (!signal.aborted) {
                    try {
                        await this.connectSilent();
                        void this.startEventSubscription();
                        this.reconnectAttempts = 0;
                        return;
                    } catch (connectError) {
                        console.error('[Reconexión] Falló reintento de conexión:', connectError);
                    }
                }
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus('error', `Event stream: ${message}`);

            const activeId = this.sessionId;
            if (activeId && this.activeStream.has(activeId)) {
                this.activeStream.delete(activeId);
                this.clearTimeout();
                this.emitStream({
                    sessionId: activeId,
                    text: '',
                    done: true,
                    error: `Conexión SSE perdida permanentemente: ${message}`,
                    statusDetail: 'Error de conexión.'
                });
            }
        }
    }
     private async handleEvent(event: ServerEvent): Promise<void> {
         const sessionId = this.sessionId;
         if (!sessionId || !this.client) {
             return;
         }

         this.resetTimeout(sessionId);

          if (event.type === 'message.part.updated') {
              await this.handleMessagePartUpdatedEvent(event);
              return;
          }

        if (event.type === 'session.idle') {
            const props = event.properties as { sessionID?: string; error?: any } | undefined;
            if (props?.sessionID !== sessionId) {
                return;
            }
            if (!this.activeStream.has(sessionId)) {
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
            
            if (props?.error || lastAssistant?.info?.error) {
                const errorObj = props?.error || lastAssistant?.info?.error;
                const errMsg = errorObj?.data?.message || errorObj?.message || errorObj?.name || 'Error del proveedor';
                
                const failedOver = await this.attemptFailover(errMsg);
                if (failedOver) {
                    return;
                }
                
                this.emitStream({ sessionId, text: '', done: true, error: errMsg, statusDetail: 'Finalizado con error.' });
            } else {
                this.emitStream({ sessionId, text, done: true, metrics: lastAssistant?.info?.tokens, statusDetail: 'Listo.' });
            }
        }

        if (event.type === 'permission.updated') {
            const perm = event.properties as { id: string; sessionID: string; title: string } | undefined;
            if (perm && perm.sessionID === sessionId) {
                const prev = this.activeStream.get(sessionId) ?? '';
                const indicator = `\n> 🔐 Esperando permiso: \`${perm.title}\`...\n`;
                if (!prev.includes(indicator)) {
                    const next = prev + indicator;
                    this.activeStream.set(sessionId, next);
                    this.emitStream({ sessionId, text: next, done: false, statusDetail: 'Esperando confirmación de permisos...' });
                }
            }
            await this.handlePermission(event.properties);
     }
}

     private async handleMessagePartUpdatedEvent(event: ServerEvent): Promise<void> {
         const sessionId = this.sessionId;
         if (!sessionId || !this.client) {
             return;
         }

         this.resetTimeout(sessionId);

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
             this.emitStream({ sessionId, text: next, done: false, statusDetail: 'Generando respuesta...' });
         } else if (props.part.type === 'call') {
             const toolName = props.part.tool || 'herramienta';
             const prev = this.activeStream.get(sessionId) ?? '';
             const indicator = `\n> ⚙️ Ejecutando: \`${toolName}\`...\n`;
             if (!prev.includes(indicator)) {
                 const next = prev + indicator;
                 this.activeStream.set(sessionId, next);
                 this.emitStream({ sessionId, text: next, done: false, statusDetail: `Ejecutando ${toolName}...` });
             }
         } else if (props.part.type === 'tool') {
             const toolName = props.part.tool || 'herramienta';
             const prev = this.activeStream.get(sessionId) ?? '';
             const status = props.part.state?.status === 'error' ? '❌ Error en' : '✅ Completado:';
             const indicator = `\n> ${status} \`${toolName}\`\n`;
             if (!prev.includes(indicator)) {
                 const next = prev + indicator;
                 this.activeStream.set(sessionId, next);
                 this.emitStream({ sessionId, text: next, done: false, statusDetail: `Herramienta ${toolName} completada.` });
             }
         }
     }

     private async attemptFailover(errMsg: string): Promise<boolean> {
        if (!this.lastPromptInfo || !this.sessionId || !this.client) return false;
        
        let providerName = 'openai';
        let modelName: string | undefined;
        
        const selectedModel = this.lastPromptInfo.model || this.getSelectedModel();
        if (selectedModel) {
            const split = selectedModel.split('::');
            if (split.length >= 1) providerName = split[0];
            if (split.length >= 2) modelName = split[1];
        }

        try {
            const secretContent = await OpenCodeService.extensionContext?.secrets.get('opencode.apis');
            if (!secretContent) {
                return false;
            }

            const config = JSON.parse(secretContent);

            // 1. Obtener la clave activa actual desde auth.json
            const authPath = getAuthPath();
            let activeKey: string | undefined;
            if (fs.existsSync(authPath)) {
                try {
                    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
                    activeKey = auth[providerName]?.key;
                } catch (e) {
                    console.error('[Failover] Error leyendo auth.json', e);
                }
            }

            // Marcar la clave fallida en el almacenamiento seguro
            if (activeKey) {
                const keysList = config[providerName] || [];
                const keyIdx = keysList.findIndex((item: any) => (typeof item === 'string' ? item : item?.key) === activeKey);
                if (keyIdx !== -1) {
                    keysList[keyIdx] = {
                        key: activeKey,
                        failed: true,
                        error: errMsg,
                        failedAt: new Date().toISOString()
                    };
                    try {
                        await OpenCodeService.extensionContext?.secrets.store('opencode.apis', JSON.stringify(config));
                        console.log('[Failover] Llave fallida marcada en almacenamiento seguro.');
                    } catch (err: any) {
                        console.error('[Failover] Error al escribir en almacenamiento seguro:', err.message);
                    }
                }
            }

            // 2. Determinar el siguiente índice de clave para el proveedor actual
            const keys = config[providerName] || [];
            const getKeyStr = (item: any) => (typeof item === 'string' ? item : item?.key);
            const isKeyFailed = (item: any) => (typeof item === 'string' ? false : !!item?.failed);

            let nextIndex = 0;
            if (activeKey) {
                const idx = keys.findIndex((item: any) => getKeyStr(item) === activeKey);
                if (idx !== -1) {
                    nextIndex = idx + 1;
                }
            }

            let nextApiKey: string | undefined;
            let targetProvider = providerName;
            let targetModel = modelName;

            let foundIdx = -1;
            for (let i = nextIndex; i < keys.length; i++) {
                if (!isKeyFailed(keys[i])) {
                    foundIdx = i;
                    break;
                }
            }

            if (foundIdx !== -1) {
                nextApiKey = getKeyStr(keys[foundIdx]);
            } else {
                // No hay más claves para el proveedor actual, buscar el siguiente proveedor disponible en apis.json
                const providers = Object.keys(config);
                const currentProvIdx = providers.indexOf(providerName);
                let found = false;

                // Buscamos a partir del siguiente proveedor circularmente
                for (let i = 1; i <= providers.length; i++) {
                    const nextProvIdx = (currentProvIdx + i) % providers.length;
                    const prov = providers[nextProvIdx];
                    const provKeys = config[prov] || [];
                    const activeKeyItem = provKeys.find((item: any) => !isKeyFailed(item));
                    if (activeKeyItem) {
                        targetProvider = prov;
                        nextApiKey = getKeyStr(activeKeyItem);
                        found = true;
                        break;
                    }
                }

                if (!found || !nextApiKey) {
                    return false; // No hay ningún proveedor con claves
                }

                // Intentar obtener un modelo válido para el nuevo proveedor
                try {
                    const providersData = await this.client.listProviders();
                    const provInfo = (providersData.all || []).find((p: any) => p.id === targetProvider);
                    if (provInfo && provInfo.models) {
                        const modelsArray = Object.values(provInfo.models);
                        if (modelsArray.length > 0) {
                            const m = modelsArray[0] as any;
                            targetModel = m.id;
                        }
                    }
                } catch (e) {
                    console.error('[Failover] Error obteniendo modelo para nuevo proveedor', e);
                }
            }

            if (!nextApiKey) {
                return false;
            }

            // 3. Escribir la nueva clave en auth.json
            if (fs.existsSync(authPath)) {
                try {
                    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
                    if (!auth[targetProvider]) {
                        auth[targetProvider] = { type: 'api' };
                    }
                    auth[targetProvider].key = nextApiKey;
                    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
                } catch (e) {
                    console.error('[Failover] Error escribiendo en auth.json', e);
                    return false;
                }
            }

            // 4. Mostrar mensaje de transición al usuario en el chat
            const displayModel = targetModel ? `${targetProvider}::${targetModel}` : targetProvider;
            if (!this.lastPromptInfo) return false;
            this.emitStream({ 
                sessionId: this.sessionId, 
                text: `\n> ⚠️ **Error detectado**: ${errMsg}\n> 🔄 **Cambiando al proveedor/clave de respaldo**: \`${displayModel}\`...\n`, 
                done: false,
                statusDetail: 'Cambiando a proveedor de respaldo...'
            });
 
            // 5. Reiniciar/Reconectar para cargar la nueva clave
            if (!this.lastPromptInfo) return false;
            this.emitStream({ 
                sessionId: this.sessionId, 
                text: `\n> 🔄 **Reiniciando servidor local de OpenCode...**\n`, 
                done: false,
                statusDetail: 'Reiniciando OpenCode...'
            });
            await this.reconnect();
 
            if (!this.lastPromptInfo) return false;
            await new Promise(r => setTimeout(r, 1500));
 
            if (!this.lastPromptInfo) return false;
            this.emitStream({ 
                sessionId: this.sessionId, 
                text: `\n> 🚀 **Reintentando consulta...**\n`, 
                done: false,
                statusDetail: 'Reintentando petición...'
            });
 
            const failoverModel = targetModel ? `${targetProvider}::${targetModel}` : undefined;
            
            // Persistir el nuevo modelo seleccionado en el estado de VS Code para que el dropdown se actualice
            if (failoverModel) {
                this.persistSelectedModel(failoverModel);
            }
 
            if (!this.lastPromptInfo) return false;
            await this.sendPrompt(
                this.lastPromptInfo.text,
                this.lastPromptInfo.agent,
                failoverModel,
                this.lastPromptInfo.contextParts,
                this.lastPromptInfo.attachments,
                true // isFailover = true
            );
 
            return true;
        } catch (e) {
            console.error('[Failover]', e);
        }
        return false;
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
