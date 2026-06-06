import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { OpenCodeService } from './opencodeService';

let chatProvider: ChatViewProvider | undefined;
let service: OpenCodeService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    service = new OpenCodeService();
    chatProvider = new ChatViewProvider(context, service);

    context.subscriptions.push(
        service,
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    await service.initialize(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('opencode.ask', () => {
            chatProvider?.focus();
        }),
        vscode.commands.registerCommand('opencode.reconnect', async () => {
            await service?.reconnect();
            await chatProvider?.refreshState();
        }),
        vscode.commands.registerCommand('opencode.newSession', async () => {
            await service?.newSession();
            await chatProvider?.refreshState();
            vscode.window.showInformationMessage('Nueva sesión OpenCode creada.');
        }),
        vscode.commands.registerCommand(
            'opencode.addFileToContext',
            async (uri?: vscode.Uri) => {
                const attachments = chatProvider?.getContextAttachments();
                if (!attachments) {
                    return;
                }
                if (uri) {
                    await attachments.addFileUri(uri);
                    chatProvider?.notifyContextChanged();
                    return;
                }
                const ok = await attachments.addCurrentFile();
                if (ok) {
                    chatProvider?.notifyContextChanged();
                }
            }
        ),
        vscode.commands.registerCommand('opencode.addSelectionToContext', async () => {
            const ok = await chatProvider
                ?.getContextAttachments()
                .addSelection();
            if (ok) {
                chatProvider?.notifyContextChanged();
            }
        }),
        vscode.commands.registerCommand('opencode.addOpenFilesToContext', async () => {
            const count = await chatProvider
                ?.getContextAttachments()
                .addOpenFiles();
            if (count && count > 0) {
                chatProvider?.notifyContextChanged();
                vscode.window.showInformationMessage(
                    `${count} archivo(s) añadidos al contexto.`
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('opencode')) {
                void service?.reconnect().then(() => chatProvider?.refreshState());
            }
        })
    );
}

export function deactivate(): void {
    service?.dispose();
    service = undefined;
    chatProvider = undefined;
}
