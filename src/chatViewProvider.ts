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
        this.postMessage({ type: 'response', text: '⏹️ Stopped' });
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
            switch (data.type) {
                case 'send':
                    this.setStatus('thinking');
                    try {
                        await this.agent.chat(data.text);
                    } catch (e) {
                        this.setStatus('error');
                    }
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
                    const result = await this.agent.testConnection();
                    if (result.success) {
                        vscode.window.showInformationMessage(`✓ ${result.message}`);
                    } else {
                        vscode.window.showErrorMessage(result.message);
                    }
                    this.postMessage({ type: 'response', text: result.success ? `✓ ${result.message}` : `❌ ${result.message}` });
                    break;
                case 'exportChat':
                    await this.exportChat();
                    break;
                case 'copyCode':
                    await vscode.env.clipboard.writeText(data.code);
                    vscode.window.showInformationMessage('Code copied to clipboard');
                    break;
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
                md += `## 👤 User\n\n${msg.content}\n\n`;
            } else if (msg.role === 'assistant' && msg.content) {
                md += `## 🤖 Assistant\n\n${msg.content}\n\n`;
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
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; height: 100vh; }
#header { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
#thread-selector { flex: 1; margin-right: 8px; }
#thread-select { width: 100%; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
.header-btns { display: flex; gap: 4px; }
.header-btn { padding: 4px 8px; background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); border-radius: 4px; cursor: pointer; font-size: 0.85em; }
.header-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
#stop { display: none; border-color: var(--vscode-inputValidation-warningBorder); }
#messages { flex: 1; overflow-y: auto; padding: 8px; }
.msg { margin: 6px 0; padding: 10px; border-radius: 6px; font-size: 0.95em; line-height: 1.5; position: relative; }
.user { background: var(--vscode-input-background); border-left: 3px solid var(--vscode-inputOption-activeBorder); white-space: pre-wrap; }
.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
.tool { font-size: 0.85em; color: var(--vscode-descriptionForeground); padding: 4px 8px; font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); border-radius: 4px; margin: 2px 0; white-space: pre-wrap; word-break: break-all; }
.status { font-size: 0.85em; color: var(--vscode-descriptionForeground); font-style: italic; padding: 4px 8px; }
.code-block { position: relative; margin: 8px 0; }
.code-block pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; margin: 0; }
.code-block code { font-family: var(--vscode-editor-font-family); font-size: 0.9em; color: var(--vscode-editor-foreground); }
.code-header { display: flex; justify-content: space-between; align-items: center; background: var(--vscode-editor-background); padding: 4px 8px; border-radius: 4px 4px 0 0; border: 1px solid var(--vscode-panel-border); border-bottom: none; }
.code-lang { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
.copy-btn { padding: 2px 8px; font-size: 0.75em; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; }
.copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.inline-code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
#input-area { display: flex; gap: 4px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
#input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; resize: none; font-family: inherit; min-height: 60px; }
#send { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; align-self: flex-end; }
#send:hover { background: var(--vscode-button-hoverBackground); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }
.typing { display: inline-block; }
.typing::after { content: '▋'; animation: blink 1s infinite; }
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
</style>
</head>
<body>
<div id="header">
    <div id="thread-selector">
        <select id="thread-select"><option value="">New Chat</option></select>
    </div>
    <div class="header-btns">
        <button id="new" class="header-btn" title="New chat">+</button>
        <button id="test" class="header-btn" title="Test connection">🔌</button>
        <button id="export" class="header-btn" title="Export chat">📥</button>
        <button id="delete" class="header-btn" title="Delete chat">🗑</button>
        <button id="stop" class="header-btn" title="Stop">⏹</button>
        <button id="settings" class="header-btn" title="Settings">⚙</button>
    </div>
</div>
<div id="messages"></div>
<div id="input-area">
    <textarea id="input" rows="3" placeholder="Ask something... (Ctrl+Shift+A)"></textarea>
    <button id="send">Send</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const newBtn = document.getElementById('new');
const testBtn = document.getElementById('test');
const deleteBtn = document.getElementById('delete');
const exportBtn = document.getElementById('export');
const threadSelect = document.getElementById('thread-select');
const settingsBtn = document.getElementById('settings');

let threads = [];
let currentThreadId = null;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
    // Code blocks with copy button
    text = text.replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/g, (match, lang, code) => {
        const escaped = escapeHtml(code.trim());
        const langLabel = lang || 'code';
        return '<div class="code-block"><div class="code-header"><span class="code-lang">' + langLabel + '</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><pre><code>' + escaped + '</code></pre></div>';
    });
    // Inline code
    text = text.replace(/\`([^\`]+)\`/g, '<code class="inline-code">$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    return text;
}

function copyCode(btn) {
    const code = btn.parentElement.nextElementSibling.textContent;
    vscode.postMessage({ type: 'copyCode', code });
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
}

function addMessage(text, cls, raw = false) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (raw || cls === 'tool' || cls === 'status' || cls === 'user') {
        div.textContent = text;
    } else {
        div.innerHTML = renderMarkdown(text);
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function setLoading(loading) {
    sendBtn.disabled = loading;
    stopBtn.style.display = loading ? 'inline-block' : 'none';
    if (loading) {
        const typing = document.createElement('div');
        typing.className = 'msg status typing';
        typing.id = 'typing-indicator';
        typing.textContent = 'Thinking';
        messages.appendChild(typing);
        messages.scrollTop = messages.scrollHeight;
    } else {
        document.getElementById('typing-indicator')?.remove();
    }
}

function updateThreadSelect() {
    threadSelect.innerHTML = '<option value="">New Chat</option>';
    threads.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        if (t.id === currentThreadId) opt.selected = true;
        threadSelect.appendChild(opt);
    });
}

function send() {
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    vscode.postMessage({ type: 'send', text });
    input.value = '';
    setLoading(true);
}

newBtn.onclick = () => {
    messages.innerHTML = '';
    currentThreadId = null;
    threadSelect.value = '';
    vscode.postMessage({ type: 'newThread' });
};

exportBtn.onclick = () => vscode.postMessage({ type: 'exportChat' });
testBtn.onclick = () => vscode.postMessage({ type: 'testConnection' });

deleteBtn.onclick = () => {
    if (currentThreadId && confirm('Delete this chat?')) {
        vscode.postMessage({ type: 'deleteThread', id: currentThreadId });
        messages.innerHTML = '';
        currentThreadId = null;
    }
};

threadSelect.onchange = () => {
    const id = threadSelect.value;
    if (id) {
        currentThreadId = id;
        messages.innerHTML = '';
        vscode.postMessage({ type: 'loadThread', id });
    } else {
        messages.innerHTML = '';
        currentThreadId = null;
        vscode.postMessage({ type: 'newThread' });
    }
};

stopBtn.onclick = () => vscode.postMessage({ type: 'stop' });
settingsBtn.onclick = () => vscode.postMessage({ type: 'openSettings' });
sendBtn.onclick = send;
input.onkeydown = (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        send(); 
    } 
};

window.addEventListener('message', (e) => {
    const data = e.data;
    switch (data.type) {
        case 'response': {
            document.getElementById('typing-indicator')?.remove();
            let cls = 'assistant';
            const text = data.text;
            if (text.startsWith('🔧') || text.startsWith('   ') || text.startsWith('✓')) cls = 'tool';
            else if (text.startsWith('[') || text.startsWith('⚠️') || text.startsWith('❌') || text.startsWith('⏹️') || text.startsWith('🚫')) cls = 'status';
            addMessage(text, cls);
            break;
        }
        case 'done':
            setLoading(false);
            vscode.postMessage({ type: 'getThreads' });
            break;
        case 'threadsUpdated':
            threads = data.threads || [];
            updateThreadSelect();
            break;
        case 'threadChanged':
            currentThreadId = data.thread?.id || null;
            updateThreadSelect();
            break;
        case 'threadLoaded':
            messages.innerHTML = '';
            (data.messages || []).forEach(m => {
                if (m.role === 'user') addMessage(m.content, 'user');
                else if (m.content) addMessage(m.content, 'assistant');
            });
            break;
    }
});

vscode.postMessage({ type: 'getThreads' });
</script>
</body>
</html>`;
    }

    async sendMessage(text: string) {
        this.setStatus('thinking');
        this.postMessage({ type: 'response', text: `You: ${text}` });
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
