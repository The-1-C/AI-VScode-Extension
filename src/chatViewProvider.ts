import * as vscode from 'vscode';
import { Agent } from './agent';
import { Thread } from './storage';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-agent.chatView';
    private webviewView?: vscode.WebviewView;
    private agent: Agent;
    private statusBar: vscode.StatusBarItem;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.agent = new Agent(
            (msg) => this.postMessage({ type: 'response', text: msg }),
            (thread) => this.postMessage({ type: 'threadChanged', thread })
        );
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.text = '$(hubot) AI Agent';
        this.statusBar.tooltip = 'AI Agent - Click to open';
        this.statusBar.command = 'ai-agent.chat';
        this.statusBar.show();
    }

    private postMessage(message: any) {
        this.webviewView?.webview.postMessage(message);
    }

    private setStatus(status: 'idle' | 'thinking' | 'error') {
        switch (status) {
            case 'thinking':
                this.statusBar.text = '$(loading~spin) AI Thinking...';
                this.statusBar.backgroundColor = undefined;
                break;
            case 'error':
                this.statusBar.text = '$(error) AI Error';
                this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            default:
                this.statusBar.text = '$(hubot) AI Agent';
                this.statusBar.backgroundColor = undefined;
        }
    }

    stop() {
        this.agent.stop();
        this.postMessage({ type: 'response', text: 'Stopped' });
        this.postMessage({ type: 'done' });
        this.setStatus('idle');
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        return this.agent.testConnection();
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('[AI Agent] Received message:', data.type);
            try {
                switch (data.type) {
                    case 'send':
                        this.setStatus('thinking');
                        await this.agent.chat(data.text);
                        this.postMessage({ type: 'done' });
                        this.setStatus('idle');
                        break;
                    case 'clear':
                        this.agent.clearHistory();
                        break;
                    case 'stop':
                        this.stop();
                        break;
                    case 'newThread':
                        this.agent.newThread();
                        this.postMessage({ type: 'response', text: 'New chat started' });
                        break;
                    case 'loadThread':
                        this.agent.loadThread(data.id);
                        this.postMessage({ type: 'threadLoaded', messages: this.getThreadMessages() });
                        break;
                    case 'deleteThread':
                        this.agent.deleteThread(data.id);
                        this.postMessage({ type: 'threadsUpdated', threads: this.agent.listThreads() });
                        break;
                    case 'getThreads':
                        this.postMessage({ type: 'threadsUpdated', threads: this.agent.listThreads() });
                        break;
                    case 'openSettings':
                        vscode.commands.executeCommand('workbench.action.openSettings', 'ai-agent');
                        break;
                    case 'testConnection':
                        this.postMessage({ type: 'response', text: 'Testing connection...' });
                        const result = await this.agent.testConnection();
                        if (result.success) {
                            vscode.window.showInformationMessage(result.message);
                            this.postMessage({ type: 'response', text: 'SUCCESS: ' + result.message });
                        } else {
                            vscode.window.showErrorMessage(result.message);
                            this.postMessage({ type: 'response', text: 'FAILED: ' + result.message });
                        }
                        break;
                    case 'exportChat':
                        await this.exportChat();
                        break;
                    case 'copyCode':
                        await vscode.env.clipboard.writeText(data.code);
                        vscode.window.showInformationMessage('Code copied to clipboard');
                        break;
                }
            } catch (e: any) {
                console.error('[AI Agent] Error:', e);
                this.postMessage({ type: 'response', text: 'Error: ' + e.message });
                this.setStatus('error');
            }
        });

        setTimeout(() => {
            this.postMessage({ type: 'threadsUpdated', threads: this.agent.listThreads() });
        }, 100);
    }

    private async exportChat() {
        const thread = this.agent.getCurrentThread();
        if (!thread) {
            vscode.window.showWarningMessage('No active chat to export');
            return;
        }

        const markdown = this.threadToMarkdown(thread);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`chat-${Date.now()}.md`),
            filters: { 'Markdown': ['md'] }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf-8'));
            vscode.window.showInformationMessage(`Chat exported to ${uri.fsPath}`);
        }
    }

    private threadToMarkdown(thread: Thread): string {
        let md = `# ${thread.title}\n\n`;
        md += `*Exported: ${new Date().toLocaleString()}*\n\n---\n\n`;
        
        for (const msg of thread.messages) {
            if (msg.role === 'user') {
                md += `## User\n\n${msg.content}\n\n`;
            } else if (msg.role === 'assistant' && msg.content) {
                md += `## Assistant\n\n${msg.content}\n\n`;
            }
        }
        return md;
    }

    private getThreadMessages(): any[] {
        const thread = this.agent.getCurrentThread();
        if (!thread) return [];
        return thread.messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content));
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { 
    font-family: var(--vscode-font-family); 
    font-size: var(--vscode-font-size); 
    display: flex; 
    flex-direction: column; 
    height: 100vh;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
}
#header { 
    display: flex; 
    gap: 8px;
    padding: 8px; 
    border-bottom: 1px solid var(--vscode-panel-border);
    align-items: center;
}
#thread-select { 
    flex: 1;
    padding: 4px 8px; 
    background: var(--vscode-input-background); 
    color: var(--vscode-input-foreground); 
    border: 1px solid var(--vscode-input-border); 
    border-radius: 4px; 
}
.btn { 
    padding: 4px 8px; 
    background: var(--vscode-button-secondaryBackground); 
    color: var(--vscode-button-secondaryForeground); 
    border: none; 
    border-radius: 4px; 
    cursor: pointer; 
    font-size: 12px;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
#messages { 
    flex: 1; 
    overflow-y: auto; 
    padding: 8px; 
}
.msg { 
    margin: 8px 0; 
    padding: 10px; 
    border-radius: 6px; 
    font-size: 13px; 
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
}
.user { 
    background: var(--vscode-input-background); 
    border-left: 3px solid var(--vscode-focusBorder); 
}
.assistant { 
    background: var(--vscode-editor-background); 
    border: 1px solid var(--vscode-panel-border); 
}
.tool { 
    font-size: 11px; 
    color: var(--vscode-descriptionForeground); 
    padding: 4px 8px; 
    font-family: monospace;
    background: var(--vscode-textBlockQuote-background);
    border-radius: 4px;
    margin: 4px 0;
}
.status { 
    font-size: 11px; 
    color: var(--vscode-descriptionForeground); 
    font-style: italic; 
    padding: 4px 8px; 
}
#input-area { 
    display: flex; 
    gap: 8px; 
    padding: 8px; 
    border-top: 1px solid var(--vscode-panel-border); 
}
#input { 
    flex: 1; 
    padding: 8px; 
    border: 1px solid var(--vscode-input-border); 
    background: var(--vscode-input-background); 
    color: var(--vscode-input-foreground); 
    border-radius: 4px; 
    resize: none; 
    font-family: inherit;
    font-size: 13px;
}
#send { 
    padding: 8px 16px; 
    background: var(--vscode-button-background); 
    color: var(--vscode-button-foreground); 
    border: none; 
    border-radius: 4px; 
    cursor: pointer;
    font-weight: 500;
}
#send:hover { background: var(--vscode-button-hoverBackground); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }
pre { 
    background: var(--vscode-textBlockQuote-background); 
    padding: 8px; 
    border-radius: 4px; 
    overflow-x: auto; 
    margin: 8px 0;
}
code { 
    font-family: var(--vscode-editor-font-family); 
    font-size: 12px; 
}
</style>
</head>
<body>
<div id="header">
    <select id="thread-select"><option value="">New Chat</option></select>
    <button class="btn" id="btnNew" title="New Chat">New</button>
    <button class="btn" id="btnTest" title="Test Connection">Test</button>
    <button class="btn" id="btnSettings" title="Settings">Settings</button>
</div>
<div id="messages"></div>
<div id="input-area">
    <textarea id="input" rows="3" placeholder="Type a message..."></textarea>
    <button id="send">Send</button>
</div>
<script>
(function() {
    const vscode = acquireVsCodeApi();
    
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const threadSelect = document.getElementById('thread-select');
    const btnNew = document.getElementById('btnNew');
    const btnTest = document.getElementById('btnTest');
    const btnSettings = document.getElementById('btnSettings');
    
    let threads = [];
    let currentThreadId = null;
    let isLoading = false;

    function log(msg) {
        console.log('[AI Agent UI]', msg);
    }

    function addMessage(text, type) {
        const div = document.createElement('div');
        div.className = 'msg ' + type;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setLoading(loading) {
        isLoading = loading;
        sendBtn.disabled = loading;
        sendBtn.textContent = loading ? 'Sending...' : 'Send';
    }

    function updateThreads() {
        threadSelect.innerHTML = '<option value="">New Chat</option>';
        threads.forEach(function(t) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.title || 'Untitled';
            if (t.id === currentThreadId) opt.selected = true;
            threadSelect.appendChild(opt);
        });
    }

    function send() {
        const text = inputEl.value.trim();
        if (!text || isLoading) return;
        log('Sending: ' + text.substring(0, 50));
        addMessage(text, 'user');
        vscode.postMessage({ type: 'send', text: text });
        inputEl.value = '';
        setLoading(true);
    }

    // Event listeners
    sendBtn.addEventListener('click', function() {
        log('Send button clicked');
        send();
    });

    inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    btnNew.addEventListener('click', function() {
        log('New button clicked');
        messagesEl.innerHTML = '';
        currentThreadId = null;
        threadSelect.value = '';
        vscode.postMessage({ type: 'newThread' });
    });

    btnTest.addEventListener('click', function() {
        log('Test button clicked');
        addMessage('Testing connection...', 'status');
        vscode.postMessage({ type: 'testConnection' });
    });

    btnSettings.addEventListener('click', function() {
        log('Settings button clicked');
        vscode.postMessage({ type: 'openSettings' });
    });

    threadSelect.addEventListener('change', function() {
        const id = threadSelect.value;
        log('Thread changed: ' + id);
        if (id) {
            currentThreadId = id;
            messagesEl.innerHTML = '';
            vscode.postMessage({ type: 'loadThread', id: id });
        } else {
            messagesEl.innerHTML = '';
            currentThreadId = null;
            vscode.postMessage({ type: 'newThread' });
        }
    });

    // Message handler
    window.addEventListener('message', function(event) {
        const data = event.data;
        log('Received: ' + data.type);
        
        switch (data.type) {
            case 'response':
                var cls = 'assistant';
                var text = data.text || '';
                if (text.indexOf('Tool:') === 0 || text.indexOf('   ') === 0) cls = 'tool';
                else if (text.indexOf('[') === 0 || text.indexOf('Testing') === 0 || text.indexOf('SUCCESS') === 0 || text.indexOf('FAILED') === 0 || text.indexOf('Error') === 0) cls = 'status';
                addMessage(text, cls);
                break;
            case 'done':
                setLoading(false);
                vscode.postMessage({ type: 'getThreads' });
                break;
            case 'threadsUpdated':
                threads = data.threads || [];
                updateThreads();
                break;
            case 'threadChanged':
                currentThreadId = data.thread ? data.thread.id : null;
                updateThreads();
                break;
            case 'threadLoaded':
                messagesEl.innerHTML = '';
                (data.messages || []).forEach(function(m) {
                    if (m.role === 'user') addMessage(m.content, 'user');
                    else if (m.content) addMessage(m.content, 'assistant');
                });
                break;
        }
    });

    // Initialize
    log('Initializing...');
    vscode.postMessage({ type: 'getThreads' });
    addMessage('AI Agent ready. Click "Test" to verify LM Studio connection.', 'status');
})();
</script>
</body>
</html>`;
    }

    async sendMessage(text: string) {
        this.setStatus('thinking');
        this.postMessage({ type: 'response', text: 'You: ' + text });
        try {
            await this.agent.chat(text);
        } catch (e) {
            this.setStatus('error');
        }
        this.postMessage({ type: 'done' });
        this.setStatus('idle');
    }

    dispose() {
        this.statusBar.dispose();
    }
}
