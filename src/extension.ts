import * as vscode from 'vscode';
import * as cp from 'child_process';
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
            const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
            const errors = diagnostics
                .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                .map(d => `Line ${d.range.start.line + 1}: ${d.message}`)
                .join('\n');
            
            const prompt = errors 
                ? `Fix errors in ${filePath}:\n${errors}`
                : `Review and fix any issues in ${filePath}`;
            await chatViewProvider.sendMessage(prompt);
        }),

        vscode.commands.registerCommand('ai-agent.askAboutSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            
            const input = await vscode.window.showInputBox({
                prompt: 'What do you want to do with the selection?',
                placeHolder: 'e.g., "explain", "optimize", "find bugs"'
            });
            
            if (input) {
                await vscode.commands.executeCommand('ai-agent.chatView.focus');
                await chatViewProvider.sendMessage(`${input} (use get_selection to see the selected code)`);
            }
        }),

        vscode.commands.registerCommand('ai-agent.explainSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
            await chatViewProvider.sendMessage('Explain this code in detail. Use get_selection to see it.');
        }),

        vscode.commands.registerCommand('ai-agent.refactorSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
            await chatViewProvider.sendMessage('Refactor this code to be cleaner and more maintainable. Use get_selection to see it, then use replace_selection to apply the refactored code.');
        }),

        vscode.commands.registerCommand('ai-agent.addTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
            const filePath = editor.document.uri.fsPath;
            await chatViewProvider.sendMessage(`Generate unit tests for the selected code. Use get_selection to see it. Create a test file appropriate for ${filePath}`);
        }),

        vscode.commands.registerCommand('ai-agent.addDocs', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showErrorMessage('No text selected');
                return;
            }
            await vscode.commands.executeCommand('ai-agent.chatView.focus');
            await chatViewProvider.sendMessage('Add documentation comments to this code. Use get_selection to see it, then use replace_selection to add JSDoc/docstring comments.');
        }),

        vscode.commands.registerCommand('ai-agent.gitCommitMessage', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace open');
                return;
            }

            try {
                const diff = cp.execSync('git diff --staged', { 
                    cwd: workspaceRoot, 
                    encoding: 'utf-8',
                    maxBuffer: 1024 * 1024
                });

                if (!diff.trim()) {
                    const unstaged = cp.execSync('git diff', { cwd: workspaceRoot, encoding: 'utf-8' });
                    if (!unstaged.trim()) {
                        vscode.window.showInformationMessage('No changes to commit');
                        return;
                    }
                    vscode.window.showInformationMessage('Stage changes first (git add)');
                    return;
                }

                await vscode.commands.executeCommand('ai-agent.chatView.focus');
                await chatViewProvider.sendMessage(`Generate a concise git commit message for these staged changes:\n\n\`\`\`diff\n${diff.slice(0, 3000)}\n\`\`\``);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Git error: ${e.message}`);
            }
        }),

        vscode.commands.registerCommand('ai-agent.stop', () => {
            chatViewProvider.stop();
        })
    );

    // Auto-fix on save (optional)
    const config = vscode.workspace.getConfiguration('ai-agent');
    if (config.get('autoFixOnSave')) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (doc) => {
                const diagnostics = vscode.languages.getDiagnostics(doc.uri);
                const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
                if (errors.length > 0) {
                    const fix = await vscode.window.showWarningMessage(
                        `${errors.length} error(s) found. Auto-fix?`,
                        'Fix', 'Ignore'
                    );
                    if (fix === 'Fix') {
                        await vscode.commands.executeCommand('ai-agent.fixFile');
                    }
                }
            })
        );
    }
}

export function deactivate() {}
