import * as vscode from 'vscode';
import { Agent } from './agent';
import { Thread } from './storage';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-agent.chatView';
    private webviewView?: vscode.WebviewView;
    private agent: Agent;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.agent = new Agent(
            (msg) => this.postMessage({ type: 'response', text: msg }),
            (thread) => this.postMessage({ type: 'threadChanged', thread })
        );
    }

    private postMessage(message: any) {
        this.webviewView?.webview.postMessage(message);
    }

    stop() {
        this.agent.stop();
        this.postMessage({ type: 'response', text: '⏹️ Stopped' });
        this.postMessage({ type: 'done' });
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.webviewView = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'send':
                    await this.agent.chat(data.text);
                    this.postMessage({ type: 'done' });
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
            }
        });

        // Send initial threads list
        setTimeout(() => {
            this.postMessage({ type: 'threadsUpdated', threads: this.agent.listThreads() });
        }, 100);
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
.msg { margin: 6px 0; padding: 8px; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; font-size: 0.95em; line-height: 1.4; }
.user { background: var(--vscode-input-background); border-left: 3px solid var(--vscode-inputOption-activeBorder); }
.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
.tool { font-size: 0.85em; color: var(--vscode-descriptionForeground); padding: 4px 8px; font-family: var(--vscode-editor-font-family); background: var(--vscode-editor-background); border-radius: 4px; margin: 2px 0; }
.status { font-size: 0.85em; color: var(--vscode-descriptionForeground); font-style: italic; padding: 4px 8px; }
.assistant code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); }
.assistant pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; }
.assistant pre code { padding: 0; background: none; }
#input-area { display: flex; gap: 4px; padding: 8px; border-top: 1px solid var(--vscode-panel-border); }
#input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; resize: none; font-family: inherit; }
#send { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
#send:hover { background: var(--vscode-button-hoverBackground); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<div id="header">
    <div id="thread-selector">
        <select id="thread-select">
            <option value="">New Chat</option>
        </select>
    </div>
    <div class="header-btns">
        <button id="new" class="header-btn" title="New chat">+</button>
        <button id="delete" class="header-btn" title="Delete chat">🗑</button>
        <button id="stop" class="header-btn" title="Stop">⏹</button>
        <button id="settings" class="header-btn" title="Settings">⚙</button>
    </div>
</div>
<div id="messages"></div>
<div id="input-area">
    <textarea id="input" rows="2" placeholder="Ask something... (Ctrl+Shift+A)"></textarea>
    <button id="send">Send</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const newBtn = document.getElementById('new');
const deleteBtn = document.getElementById('delete');
const threadSelect = document.getElementById('thread-select');
const settingsBtn = document.getElementById('settings');

let threads = [];
let currentThreadId = null;

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
    text = text.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    text = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    return text;
}

function addMessage(text, cls, raw = false) {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (raw || cls === 'tool' || cls === 'status' || cls === 'user') {
        div.textContent = text;
    } else {
        div.innerHTML = renderMarkdown(escapeHtml(text));
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

function setLoading(loading) {
    sendBtn.disabled = loading;
    stopBtn.style.display = loading ? 'inline-block' : 'none';
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
            let cls = 'assistant';
            const text = data.text;
            if (text.startsWith('🔧') || text.startsWith('   ') || text.startsWith('✓')) cls = 'tool';
            else if (text.startsWith('[') || text.startsWith('⚠️') || text.startsWith('❌') || text.startsWith('⏹️')) cls = 'status';
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
        this.postMessage({ type: 'response', text: `You: ${text}` });
        await this.agent.chat(text);
        this.postMessage({ type: 'done' });
    }
}
