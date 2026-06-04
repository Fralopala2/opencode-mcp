import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextAttachments } from './contextAttachments';
import { contextLabel } from './parts';
import { OpenCodeService } from './opencodeService';
import { getOpenCodeSettings } from './settings';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'opencode.mcp';

    private view: vscode.WebviewView | undefined;
    private readonly contextAttachments = new ContextAttachments();
    private selectedAgent = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly service: OpenCodeService
    ) {
        service.onStream((update) => {
            if (update.done) {
                if (update.error) {
                    this.post({ type: 'error', message: update.error });
                } else {
                    this.post({ type: 'assistantDone', text: update.text, metrics: update.metrics });
                }
                this.post({ type: 'status', state: 'idle' });
            } else {
                this.post({ type: 'assistantStream', text: update.text });
            }
        });

        service.onStatus((state, detail) => {
            this.post({
                type: 'connection',
                state,
                detail,
            });
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.onMessage(message);
        });

        void this.refreshState();
    }

    focus(): void {
        if (this.view) {
            this.view.show?.(true);
        } else {
            void vscode.commands.executeCommand('opencode.mcp.focus');
        }
    }

    async refreshState(): Promise<void> {
        const settings = getOpenCodeSettings();
        this.selectedAgent = settings.defaultAgent;
        try {
            const agents = await this.service.listAgents();
            const models = await this.service.listModels();
            const primary = agents.filter((a) => a.mode === 'primary' || a.mode === 'all');
            this.post({
                type: 'init',
                agents: primary.map((a) => ({
                    name: a.name,
                    description: a.description ?? '',
                })),
                models,
                selectedAgent: this.selectedAgent,
                context: this.contextAttachments
                    .getItems()
                    .map((p) => contextLabel(p)),
                sessionId: this.service.getSessionId(),
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.post({ type: 'error', message: msg });
        }
    }

    getContextAttachments(): ContextAttachments {
        return this.contextAttachments;
    }

    private post(payload: unknown): void {
        void this.view?.webview.postMessage(payload);
    }

    private async onMessage(message: {
        type: string;
        text?: string;
        agent?: string;
        model?: string;
        attachments?: any[];
    }): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.refreshState();
                break;
            case 'send': {
                const text = message.text?.trim();
                const attachments = message.attachments || [];
                if (!text && attachments.length === 0) {
                    return;
                }
                const agent = message.agent || this.selectedAgent || undefined;
                const model = message.model || undefined;
                const contextParts = [...this.contextAttachments.getItems()];
                this.contextAttachments.clear();
                this.post({ type: 'user', text: text || '(Solo adjuntos)' });
                this.post({ type: 'status', state: 'busy' });
                this.post({
                    type: 'context',
                    items: [],
                });
                try {
                    await this.service.sendPrompt(text || '', agent, model, contextParts, attachments);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.post({ type: 'error', message: msg });
                    this.post({ type: 'status', state: 'idle' });
                }
                break;
            }
            case 'setAgent':
                this.selectedAgent = message.agent ?? '';
                break;
            case 'reconnect':
                this.post({ type: 'status', state: 'connecting' });
                try {
                    await this.service.reconnect();
                    await this.refreshState();
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.post({ type: 'error', message: msg });
                }
                break;
            case 'newSession':
                try {
                    await this.service.newSession();
                    await this.refreshState();
                    this.post({ type: 'system', text: 'Nueva sesión creada.' });
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.post({ type: 'error', message: msg });
                }
                break;
            case 'abort':
                try {
                    await this.service.abortSession();
                    this.post({ type: 'system', text: 'Sesión abortada.' });
                    this.post({ type: 'status', state: 'idle' });
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.post({ type: 'error', message: msg });
                }
                break;
            case 'attachFile':
                const fileUris = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    openLabel: 'Adjuntar',
                });
                if (fileUris && fileUris.length > 0) {
                    for (const uri of fileUris) {
                        try {
                            const buffer = await vscode.workspace.fs.readFile(uri);
                            let mime = 'application/octet-stream';
                            const ext = path.extname(uri.fsPath).toLowerCase();
                            if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                                mime = `image/${ext.replace('.', '').replace('jpg', 'jpeg')}`;
                                const b64 = Buffer.from(buffer).toString('base64');
                                this.post({
                                    type: 'fileAttached',
                                    attachment: {
                                        type: 'file',
                                        mime,
                                        filename: path.basename(uri.fsPath),
                                        url: `data:${mime};base64,${b64}`,
                                    },
                                });
                            } else {
                                // Enviar la ruta del archivo para archivos locales no-imágenes
                                this.post({
                                    type: 'fileAttached',
                                    attachment: {
                                        type: 'file',
                                        mime: 'text/plain',
                                        filename: path.basename(uri.fsPath),
                                        url: `file://${uri.fsPath}`,
                                    },
                                });
                            }
                        } catch (e) {
                            this.post({ type: 'error', message: `No se pudo adjuntar: ${path.basename(uri.fsPath)}` });
                        }
                    }
                }
                break;
            default:
                break;
        }
    }

    notifyContextChanged(): void {
        this.post({
            type: 'context',
            items: this.contextAttachments.getItems().map((p) => contextLabel(p)),
        });
    }

    private getHtml(webview: vscode.Webview): string {
        const htmlPath = path.join(
            this.extensionUri.fsPath,
            'resources',
            'webview',
            'index.html'
        );
        const scriptPath = path.join(
            this.extensionUri.fsPath,
            'resources',
            'webview',
            'main.js'
        );
        let html = fs.readFileSync(htmlPath, 'utf8');
        const scriptUri = webview
            .asWebviewUri(vscode.Uri.file(scriptPath))
            .toString();
        const nonce = getNonce();

        html = html
            .replaceAll('{{cspSource}}', webview.cspSource)
            .replaceAll('{{nonce}}', nonce)
            .replaceAll('{{scriptUri}}', scriptUri);

        return html;
    }
}

function getNonce(): string {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
