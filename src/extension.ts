import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';

let chatViewProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
    chatViewProvider = new ChatViewProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider),

        vscode.commands.registerCommand('ai-agent.chat', async () => {
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
        }),

        vscode.commands.registerCommand('ai-agent.fixFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No file open');
                return;
            }
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
            const filePath = editor.document.uri.fsPath;
            await chatViewProvider.sendMessage(`Fix any errors in ${filePath}`);
        }),

        vscode.commands.registerCommand('ai-agent.askAboutSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            
            const input = await vscode.window.showInputBox({
                prompt: 'What do you want to do with the selection?',
                placeHolder: 'e.g., "explain this", "refactor", "add comments"'
            });
            
            if (input) {
                await vscode.commands.executeCommand('ai-agent.chatView.focus');
                await chatViewProvider.sendMessage(`${input} (I have text selected in the editor, use get_selection to see it)`);
            }
        }),

        vscode.commands.registerCommand('ai-agent.stop', () => {
            chatViewProvider.stop();
        })
    );
}

export function deactivate() {}
