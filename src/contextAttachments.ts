import * as vscode from 'vscode';
import { buildFilePart, buildSelectionPart, type PromptPart } from './parts';

export class ContextAttachments {
    private readonly items: PromptPart[] = [];
    private readonly MAX_SIZE_BYTES = 1024 * 1024; // 1MB

    getItems(): readonly PromptPart[] {
        return this.items;
    }

    clear(): void {
        this.items.length = 0;
    }

    addPart(part: PromptPart): void {
        this.items.push(part);
    }

    removePart(index: number): void {
        if (index >= 0 && index < this.items.length) {
            this.items.splice(index, 1);
        }
    }

    async addCurrentFile(): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No hay ningún archivo abierto.');
            return false;
        }
        const doc = editor.document;
        if (doc.isUntitled) {
            vscode.window.showWarningMessage('Guarda el archivo antes de añadirlo al contexto.');
            return false;
        }
        
        // Comprobar tamaño (aproximado por longitud de texto ya que ya está en memoria)
        if (doc.getText().length > this.MAX_SIZE_BYTES) {
            vscode.window.showWarningMessage('El archivo es demasiado grande (>1MB) y no será añadido al contexto.');
            return false;
        }

        this.addPart(buildFilePart(doc.uri.fsPath, doc.getText()));
        return true;
    }

    async addSelection(): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('Selecciona un rango de líneas primero.');
            return false;
        }
        const doc = editor.document;
        if (doc.isUntitled) {
            vscode.window.showWarningMessage('Guarda el archivo antes de añadir la selección.');
            return false;
        }
        
        const text = doc.getText(editor.selection);
        if (text.length > this.MAX_SIZE_BYTES) {
            vscode.window.showWarningMessage('La selección es demasiado grande (>1MB) y no será añadida al contexto.');
            return false;
        }

        const startLine = editor.selection.start.line;
        const endLine = editor.selection.end.line;
        this.addPart(
            buildSelectionPart(doc.uri.fsPath, doc.getText(), startLine, endLine)
        );
        return true;
    }

    async addOpenFiles(): Promise<number> {
        let count = 0;
        let skippedCount = 0;
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (!(input instanceof vscode.TabInputText)) {
                    continue;
                }
                try {
                    const stat = await vscode.workspace.fs.stat(input.uri);
                    if (stat.size > this.MAX_SIZE_BYTES) {
                        skippedCount++;
                        continue;
                    }
                    
                    const doc = await vscode.workspace.openTextDocument(input.uri);
                    if (doc.isUntitled) {
                        continue;
                    }
                    this.addPart(buildFilePart(doc.uri.fsPath, doc.getText()));
                    count++;
                } catch {
                    // Ignorar pestañas que no se pueden leer
                }
            }
        }
        
        if (count === 0 && skippedCount === 0) {
            vscode.window.showWarningMessage('No hay archivos de texto válidos abiertos.');
        } else if (skippedCount > 0) {
            vscode.window.showInformationMessage(`Se añadieron ${count} archivos. Se omitieron ${skippedCount} archivo(s) por exceder el límite de 1MB.`);
        }
        return count;
    }

    async addFileUri(uri: vscode.Uri): Promise<void> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > this.MAX_SIZE_BYTES) {
                vscode.window.showWarningMessage(`El archivo supera el límite de 1MB y será omitido: ${uri.fsPath}`);
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            this.addPart(buildFilePart(doc.uri.fsPath, doc.getText()));
        } catch {
            vscode.window.showErrorMessage(`No se pudo leer el archivo: ${uri.fsPath}`);
        }
    }
}
