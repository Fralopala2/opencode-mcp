import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ContextAttachments } from './contextAttachments';
import { contextLabel, partsToDisplayText } from './parts';
import { OpenCodeService } from './opencodeService';
import { getOpenCodeSettings, getWorkspaceDirectory } from './settings';
import { PromptPart } from './types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'opencode.mcp';

    private view: vscode.WebviewView | undefined;
    private readonly contextAttachments = new ContextAttachments();
    private selectedAgent = '';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly service: OpenCodeService
    ) {
        service.onStream((update) => {
            if (update.done) {
                if (update.error) {
                    this.post({ type: 'error', message: update.error });
                } else {
                     this.post({ type: 'assistantDone', text: update.text, metrics: update.metrics });
                     
                     // Actualizar costos en globalState
                     if (update.metrics) {
                         const today = new Date().toISOString().split('T')[0];
                         const model = this.service.getSelectedModel() || 'default';
                         
                         let costData: Record<string, any> = this.context.globalState.get('costData') || {};
                         
                         const cost = this.calculateCost(update.metrics.input, update.metrics.output, model);
                         
                         if (!costData[today]) {
                             costData[today] = {};
                         }
                         
                         if (!costData[today][model]) {
                             costData[today][model] = { usd: 0, eur: 0 };
                         }
                         
                         costData[today][model].usd += cost.usd;
                         costData[today][model].eur += cost.eur;
                         
                         this.context.globalState.update('costData', costData);
                     }
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
            localResourceRoots: [this.context.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.onMessage(message);
        });

        void this.refreshState();
     }

     private calculateCost(inputTokens: number, outputTokens: number, model: string): { usd: number, eur: number } {
         const modelPrices: Record<string, { input: number, output: number }> = {
           'mistral-medium-latest': { input: 2.00, output: 6.00 },
           'default': { input: 2.00, output: 6.00 }
         };

         const price = modelPrices[model] || modelPrices['default'];
         const usd = (inputTokens * price.input + outputTokens * price.output) / 1000000;
         const eur = usd * 0.92;

         return { usd, eur };
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
            
            const sessionId = this.service.getSessionId() ?? '';
            let parsedMessages: any[] = [];
            if (sessionId) {
                try {
                    const messages = await this.service.listMessages(sessionId);
                    parsedMessages = messages.map(m => {
                        const hasError = !!m.info.error;
                        return {
                            role: hasError ? 'error' : m.info.role,
                            text: hasError
                                ? (m.info.error?.data?.message || m.info.error?.message || m.info.error?.name || 'Error del proveedor')
                                : partsToDisplayText(m.parts),
                            metrics: m.info.tokens
                        };
                    });
                } catch {
                    // Ignore message load error
                }
            }

                 let costData: Record<string, any> = this.context.globalState.get('costData') || {};

                 this.post({
                     type: 'init',
                     agents: primary.map((a) => ({
                         name: a.name,
                         description: a.description ?? '',
                     })),
                     models,
                     selectedAgent: this.selectedAgent,
                     selectedModel: this.service.getSelectedModel(),
                     context: this.contextAttachments
                         .getItems()
                         .map((p) => contextLabel(p)),
                     sessionId,
                     messages: parsedMessages,
                     quickActions: vscode.workspace.getConfiguration('opencode').get('quickActions') || [],
                     costData
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

    private async onMessage(message: any): Promise<void> {
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
            case 'setModel':
                this.service.persistSelectedModel(message.model ?? '');
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
            case 'clearChat': {
                const choice = await vscode.window.showWarningMessage(
                    '¿Estás seguro de que quieres limpiar el chat?',
                    { modal: true },
                    'Limpiar'
                );
                if (choice === 'Limpiar') {
                    try {
                        await this.service.newSession();
                        await this.refreshState();
                        this.post({ type: 'chatCleared' });
                    } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.post({ type: 'error', message: msg });
                    }
                }
                break;
            }
            case 'exportChat': {
                const sessionId = this.service.getSessionId();
                if (!sessionId) {
                    vscode.window.showErrorMessage('No hay sesión activa para exportar.');
                    break;
                }
                try {
                    const messages = await this.service.listMessages(sessionId);
                    if (messages.length === 0) {
                        vscode.window.showInformationMessage('La conversación está vacía.');
                        break;
                    }

                    const format = await vscode.window.showQuickPick(
                        ['Markdown (.md)', 'JSON (.json)', 'Texto plano (.txt)'],
                        { placeHolder: 'Selecciona el formato de exportación' }
                    );
                    if (!format) {
                        break;
                    }

                    let defaultExt = '.md';
                    let filterName = 'Markdown Files';
                    if (format.includes('JSON')) {
                        defaultExt = '.json';
                        filterName = 'JSON Files';
                    } else if (format.includes('Texto')) {
                        defaultExt = '.txt';
                        filterName = 'Text Files';
                    }

                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(path.join(getWorkspaceDirectory() || '', `chat-export${defaultExt}`)),
                        filters: { [filterName]: [defaultExt.substring(1)] }
                    });

                    if (!uri) {
                        break;
                    }

                    let content = '';
                    if (defaultExt === '.json') {
                        const simpleMessages = messages.map(m => ({
                            role: m.info.role,
                            text: partsToDisplayText(m.parts),
                            timestamp: new Date().toISOString()
                        }));
                        content = JSON.stringify(simpleMessages, null, 2);
                    } else if (defaultExt === '.md') {
                        content = `# Exportación de Conversación de OpenCode\n\n`;
                        messages.forEach(m => {
                            const roleDisplay = m.info.role === 'user' ? 'Tú' : 'OpenCode';
                            content += `### **${roleDisplay}**\n\n${partsToDisplayText(m.parts)}\n\n---\n\n`;
                        });
                    } else {
                        messages.forEach(m => {
                            const roleDisplay = m.info.role === 'user' ? 'Tú' : 'OpenCode';
                            content += `[${roleDisplay}]:\n${partsToDisplayText(m.parts)}\n\n`;
                        });
                    }

                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                    vscode.window.showInformationMessage(`Conversación exportada exitosamente.`);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Error al exportar conversación: ${msg}`);
                }
                break;
            }
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
            case 'openSettings':
                void vscode.commands.executeCommand('workbench.action.openSettings');
                break;
            case 'showHistory': {
                try {
                    const sessions = await this.service.listSessions();
                    if (sessions.length === 0) {
                        vscode.window.showInformationMessage('No hay sesiones anteriores.');
                        return;
                    }
                    const items = sessions.map((s) => ({
                        label: s.title || `Sesión ${s.id.slice(0, 8)}`,
                        description: s.id,
                        session: s,
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Selecciona una sesión para cargar',
                    });
                    if (selected) {
                        await this.service.selectSession(selected.session.id);
                        await this.refreshState();
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Error al listar sesiones: ${msg}`);
                }
                break;
            }
            case 'addContextFile': {
                const fileUris = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    openLabel: 'Añadir al contexto',
                });
                if (fileUris && fileUris.length > 0) {
                    for (const uri of fileUris) {
                        try {
                            await this.contextAttachments.addFileUri(uri);
                        } catch (e) {
                            this.post({ type: 'error', message: `No se pudo añadir al contexto: ${path.basename(uri.fsPath)}` });
                        }
                    }
                    this.notifyContextChanged();
                }
                break;
            }
            case 'removeContext': {
                const index = message.index;
                if (typeof index === 'number') {
                    this.contextAttachments.removePart(index);
                    this.notifyContextChanged();
                }
                break;
            }
            case 'quickAction': {
                const action = message.text;
                if (this.contextAttachments.getItems().length === 0) {
                    await this.contextAttachments.addCurrentFile();
                    this.notifyContextChanged();
                }
                const text = action;
                const agent = this.selectedAgent || undefined;
                const model = message.model || undefined;
                const contextParts = [...this.contextAttachments.getItems()];
                this.contextAttachments.clear();
                this.post({ type: 'status', state: 'busy' });
                this.post({
                    type: 'context',
                    items: [],
                });
                try {
                    await this.service.sendPrompt(text || '', agent, model, contextParts, []);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.post({ type: 'error', message: msg });
                    this.post({ type: 'status', state: 'idle' });
                }
                break;
            }
            case 'insertCodeBlock': {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const selection = editor.document.getText(editor.selection);
                    const formatted = selection ? `\`\`\`\n${selection}\n\`\`\`` : `\`\`\`\n\n\`\`\``;
                    this.post({ type: 'insertText', text: formatted });
                } else {
                    this.post({ type: 'insertText', text: `\`\`\`\n\n\`\`\`` });
                }
                break;
            }
            case 'addCurrentFileToContext': {
                await this.contextAttachments.addCurrentFile();
                this.notifyContextChanged();
                break;
            }
            case 'addSelectionToContext': {
                await this.contextAttachments.addSelection();
                this.notifyContextChanged();
                break;
            }
            case 'gitDiff': {
                const cwd = getWorkspaceDirectory();
                if (cwd) {
                    execFile('git', ['diff'], { cwd }, (err, stdout, stderr) => {
                        if (stdout) {
                            this.contextAttachments.addPart({
                                type: 'text',
                                text: `Archivo: git-diff.patch\n\`\`\`diff\n${stdout}\n\`\`\``
                            });
                            this.notifyContextChanged();
                        } else {
                            vscode.window.showInformationMessage('No hay cambios sin confirmar (git diff vacío).');
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('No hay directorio de espacio de trabajo abierto.');
                }
                break;
            }
             case 'attachFolder':
                 const folderUri = await vscode.window.showOpenDialog({
                     canSelectFiles: false,
                     canSelectFolders: true,
                     canSelectMany: false,
                     openLabel: 'Adjuntar Carpeta',
                 });
                 if (folderUri && folderUri.length > 0) {
                     const folderPath = folderUri[0].fsPath;
                     this.contextAttachments.addPart({
                         type: 'text',
                         text: `Carpeta adjunta: ${folderPath}`,
                     });
                     this.notifyContextChanged();
                     this.post({
                         type: 'system',
                         text: `Carpeta adjunta al contexto: ${folderPath}`,
                     });
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
            case 'loadCostData': {
                let costData: Record<string, any> = this.context.globalState.get('costData') || {};
                this.post({ type: 'costDataUpdate', costData });
                break;
            }
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
            this.context.extensionUri.fsPath,
            'resources',
            'webview',
            'index.html'
        );
        const scriptPath = path.join(
            this.context.extensionUri.fsPath,
            'resources',
            'webview',
            'main.js'
        );
        const logoPath = path.join(
            this.context.extensionUri.fsPath,
            'resources',
            'logo.svg'
        );
        let html = fs.readFileSync(htmlPath, 'utf8');
        const scriptUri = webview
            .asWebviewUri(vscode.Uri.file(scriptPath))
            .toString();
        const logoUri = webview
            .asWebviewUri(vscode.Uri.file(logoPath))
            .toString();
        const nonce = getNonce();

        html = html
            .replaceAll('{{cspSource}}', webview.cspSource)
            .replaceAll('{{nonce}}', nonce)
            .replaceAll('{{scriptUri}}', scriptUri)
            .replaceAll('{{logoUri}}', logoUri);

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
