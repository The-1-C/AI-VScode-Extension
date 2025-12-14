import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { Storage, Thread } from './storage';

interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
}

interface Message {
    role: string;
    content?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

const SYSTEM_PROMPT = `You are an AI coding agent inside VS Code, similar to GitHub Copilot or Cursor. You help users write, fix, and understand code.

AVAILABLE TOOLS:

FILE OPERATIONS:
- list_files(path?, recursive?) - List files in directory
- read_file(path) - Read a file's contents
- write_file(path, content) - Write/overwrite file with COMPLETE content
- delete_file(path) - Delete a file
- search_files(query, path?, filePattern?) - Search for text in files

EDITOR OPERATIONS:
- get_active_file() - Get currently open file path and content
- get_selection() - Get selected text in editor
- replace_selection(text) - Replace selection with new text
- insert_text(text) - Insert text at cursor
- get_diagnostics(path?) - Get VS Code errors/warnings

MEMORY (persists across sessions):
- remember(fact) - Store an important fact for future reference
- recall() - Retrieve all remembered facts
- forget(index) - Remove a remembered fact by index

SYSTEM:
- run_command(cmd) - Run shell command

GUIDELINES:
1. Read files before modifying them
2. Use get_diagnostics() to find errors
3. When writing files, include COMPLETE content
4. Use remember() to save important project context
5. For small edits, prefer replace_selection() over rewriting entire files
6. Be concise but helpful in responses`;

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in directory',
            parameters: {
                type: 'object',
                properties: { 
                    path: { type: 'string', description: 'Directory path' },
                    recursive: { type: 'boolean', description: 'List recursively' }
                }
            }
        }
    },
    {
        type: 'function', 
        function: {
            name: 'read_file',
            description: 'Read file contents',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write complete content to file',
            parameters: {
                type: 'object',
                properties: { 
                    path: { type: 'string' },
                    content: { type: 'string' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for text pattern in files',
            parameters: {
                type: 'object',
                properties: { 
                    query: { type: 'string' },
                    path: { type: 'string' },
                    filePattern: { type: 'string' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Run shell command',
            parameters: {
                type: 'object',
                properties: { cmd: { type: 'string' } },
                required: ['cmd']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_active_file',
            description: 'Get the currently open file',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_selection',
            description: 'Get selected text in editor',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'replace_selection',
            description: 'Replace selected text',
            parameters: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'insert_text',
            description: 'Insert text at cursor',
            parameters: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_diagnostics',
            description: 'Get VS Code errors/warnings',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'remember',
            description: 'Store a fact in persistent memory for future sessions',
            parameters: {
                type: 'object',
                properties: { fact: { type: 'string', description: 'Important fact to remember' } },
                required: ['fact']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'recall',
            description: 'Retrieve all remembered facts from memory',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'forget',
            description: 'Remove a fact from memory by index',
            parameters: {
                type: 'object',
                properties: { index: { type: 'number', description: 'Index of fact to forget (1-based)' } },
                required: ['index']
            }
        }
    }
];

export class Agent {
    private log: (msg: string) => void;
    private messages: Message[] = [];
    private workspaceRoot: string;
    private abortController?: AbortController;
    private storage: Storage;
    private currentThread: Thread | null = null;
    private onThreadChange?: (thread: Thread | null) => void;

    constructor(log: (msg: string) => void, onThreadChange?: (thread: Thread | null) => void) {
        this.log = log;
        this.onThreadChange = onThreadChange;
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.storage = new Storage();
        this.initMessages();
    }

    private initMessages() {
        const memoryContext = this.storage.getMemoryContext();
        const config = this.getConfig();
        let prompt = SYSTEM_PROMPT + memoryContext;
        if (config.systemPromptAddition) {
            prompt += '\n\nADDITIONAL USER INSTRUCTIONS:\n' + config.systemPromptAddition;
        }
        this.messages = [{ role: 'system', content: prompt }];
    }

    // Thread management
    newThread(): Thread {
        const thread: Thread = {
            id: this.storage.generateThreadId(),
            title: 'New Chat',
            created: Date.now(),
            updated: Date.now(),
            messages: []
        };
        this.currentThread = thread;
        this.initMessages();
        this.onThreadChange?.(thread);
        return thread;
    }

    loadThread(id: string): boolean {
        const thread = this.storage.loadThread(id);
        if (!thread) return false;
        this.currentThread = thread;
        this.initMessages();
        this.messages.push(...thread.messages);
        this.onThreadChange?.(thread);
        return true;
    }

    deleteThread(id: string): boolean {
        const result = this.storage.deleteThread(id);
        if (this.currentThread?.id === id) {
            this.currentThread = null;
            this.initMessages();
            this.onThreadChange?.(null);
        }
        return result;
    }

    listThreads(): Thread[] {
        return this.storage.listThreads();
    }

    getCurrentThread(): Thread | null {
        return this.currentThread;
    }

    private saveCurrentThread() {
        const config = this.getConfig();
        if (!config.autoSave) return;
        
        if (!this.currentThread) {
            this.currentThread = this.newThread();
        }
        this.currentThread.messages = this.messages.slice(1);
        this.currentThread.updated = Date.now();
        
        if (this.currentThread.title === 'New Chat') {
            const firstUserMsg = this.messages.find(m => m.role === 'user');
            if (firstUserMsg?.content) {
                this.currentThread.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
            }
        }
        
        this.storage.saveThread(this.currentThread);
    }
    
    private logTool(msg: string) {
        if (this.getConfig().showToolCalls) {
            this.log(msg);
        }
    }

    clearHistory() {
        this.currentThread = null;
        this.initMessages();
        this.onThreadChange?.(null);
    }

    stop() {
        this.abortController?.abort();
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('ai-agent');
        return {
            apiUrl: config.get<string>('apiUrl') || 'http://127.0.0.1:1234/v1/chat/completions',
            model: config.get<string>('model') || 'local-model',
            temperature: config.get<number>('temperature') ?? 0.1,
            maxTokens: config.get<number>('maxTokens') ?? 4096,
            timeout: config.get<number>('timeout') ?? 120000,
            autoSave: config.get<boolean>('autoSave') ?? true,
            systemPromptAddition: config.get<string>('systemPromptAddition') || '',
            showToolCalls: config.get<boolean>('showToolCalls') ?? true
        };
    }

    private async callLLM(): Promise<any> {
        const config = this.getConfig();
        this.abortController = new AbortController();
        this.log(`[Calling LLM...]`);
        
        const timeoutId = setTimeout(() => this.abortController?.abort(), config.timeout);
        
        try {
            const response = await fetch(config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.model,
                    messages: this.messages,
                    tools: TOOLS,
                    tool_choice: 'auto',
                    temperature: config.temperature,
                    max_tokens: config.maxTokens
                }),
                signal: this.abortController.signal
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private resolvePath(p: string): string {
        if (!p) return this.workspaceRoot;
        if (path.isAbsolute(p)) return p;
        return path.join(this.workspaceRoot, p);
    }

    private listFilesRecursive(dir: string, base: string = ''): string[] {
        const results: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const relPath = base ? `${base}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        results.push(...this.listFilesRecursive(path.join(dir, entry.name), relPath));
                    }
                } else {
                    results.push(relPath);
                }
            }
        } catch {}
        return results;
    }

    private searchInFiles(query: string, dir: string, pattern?: string): string[] {
        const results: string[] = [];
        const regex = new RegExp(query, 'gi');
        const files = this.listFilesRecursive(dir);
        
        for (const file of files.slice(0, 100)) {
            if (pattern && !this.matchGlob(file, pattern)) continue;
            const fullPath = path.join(dir, file);
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                lines.forEach((line, i) => {
                    if (regex.test(line)) {
                        results.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
                    }
                });
            } catch {}
        }
        return results.slice(0, 50);
    }

    private matchGlob(file: string, pattern: string): boolean {
        const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        return new RegExp(regexPattern).test(file);
    }

    private async executeTool(name: string, args: Record<string, any>): Promise<string> {
        try {
            switch (name) {
                case 'list_files': {
                    const dir = this.resolvePath(args.path);
                    if (!fs.existsSync(dir)) return `Error: Not found: ${args.path || '.'}`;
                    if (fs.statSync(dir).isFile()) return `Error: '${args.path}' is a file`;
                    if (args.recursive) {
                        return this.listFilesRecursive(dir).join('\n') || '(empty)';
                    }
                    return fs.readdirSync(dir).join('\n') || '(empty)';
                }
                case 'read_file': {
                    const filePath = this.resolvePath(args.path);
                    if (!fs.existsSync(filePath)) return `Error: File not found: ${args.path}`;
                    return fs.readFileSync(filePath, 'utf-8');
                }
                case 'write_file': {
                    const filePath = this.resolvePath(args.path);
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, args.content, 'utf-8');
                    return `✓ Written: ${args.path}`;
                }
                case 'delete_file': {
                    const filePath = this.resolvePath(args.path);
                    if (!fs.existsSync(filePath)) return `Error: Not found: ${args.path}`;
                    fs.unlinkSync(filePath);
                    return `✓ Deleted: ${args.path}`;
                }
                case 'search_files': {
                    const dir = this.resolvePath(args.path);
                    const results = this.searchInFiles(args.query, dir, args.filePattern);
                    return results.length ? results.join('\n') : 'No matches found';
                }
                case 'run_command': {
                    try {
                        const result = cp.execSync(args.cmd, { 
                            cwd: this.workspaceRoot,
                            encoding: 'utf-8',
                            timeout: 30000
                        });
                        return result || '(no output)';
                    } catch (e: any) {
                        return `Exit ${e.status}: ${e.stderr || e.stdout || e.message}`;
                    }
                }
                case 'get_active_file': {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) return 'No file open';
                    return `File: ${editor.document.uri.fsPath}\nLanguage: ${editor.document.languageId}\n\n${editor.document.getText()}`;
                }
                case 'get_selection': {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) return 'No file open';
                    const text = editor.document.getText(editor.selection);
                    if (!text) return 'No text selected';
                    return `Selected (lines ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}):\n\n${text}`;
                }
                case 'replace_selection': {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) return 'No file open';
                    await editor.edit(b => b.replace(editor.selection, args.text));
                    return `✓ Replaced selection`;
                }
                case 'insert_text': {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) return 'No file open';
                    await editor.edit(b => b.insert(editor.selection.active, args.text));
                    return `✓ Inserted text`;
                }
                case 'get_diagnostics': {
                    const diagnostics: string[] = [];
                    const targetPath = args.path ? this.resolvePath(args.path) : null;
                    vscode.languages.getDiagnostics().forEach(([uri, diags]) => {
                        if (targetPath && uri.fsPath !== targetPath) return;
                        diags.forEach(d => {
                            const sev = ['Error', 'Warning', 'Info', 'Hint'][d.severity];
                            diagnostics.push(`${path.basename(uri.fsPath)}:${d.range.start.line + 1}: [${sev}] ${d.message}`);
                        });
                    });
                    return diagnostics.length ? diagnostics.join('\n') : 'No diagnostics';
                }
                case 'remember': {
                    this.storage.addMemory(args.fact);
                    return `✓ Remembered: "${args.fact}"`;
                }
                case 'recall': {
                    const memory = this.storage.loadMemory();
                    if (memory.facts.length === 0) return 'No memories stored yet.';
                    return memory.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
                }
                case 'forget': {
                    const idx = (args.index || 1) - 1;
                    if (this.storage.removeMemory(idx)) {
                        return `✓ Forgot item ${args.index}`;
                    }
                    return `Error: Invalid index ${args.index}`;
                }
                default:
                    return `Error: Unknown tool: ${name}`;
            }
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }

    async chat(userMessage: string): Promise<void> {
        this.messages.push({ role: 'user', content: userMessage });

        for (let i = 0; i < 15; i++) {
            let res: any;
            try {
                res = await this.callLLM();
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    this.log('⏹️ Stopped');
                    this.saveCurrentThread();
                    return;
                }
                this.log(`❌ API Error: ${e.message}`);
                return;
            }

            if (res.error) {
                this.log(`❌ API Error: ${res.error.message || JSON.stringify(res.error)}`);
                return;
            }

            const msg = res.choices?.[0]?.message;
            if (!msg) continue;

            if (msg.tool_calls?.length) {
                this.messages.push(msg);
                
                for (const tc of msg.tool_calls) {
                    const name = tc.function.name;
                    let args: Record<string, any> = {};
                    try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
                    
                    const argStr = Object.entries(args)
                        .filter(([k]) => k !== 'content')
                        .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 30 ? v.slice(0, 30) + '...' : v}`)
                        .join(', ');
                    this.logTool(`🔧 ${name}(${argStr})`);
                    
                    const result = await this.executeTool(name, args);
                    const preview = result.length > 400 ? result.slice(0, 400) + '...' : result;
                    this.logTool(`   ${preview}`);
                    
                    this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                }
                continue;
            }

            if (msg.content) {
                this.messages.push(msg);
                this.log(msg.content);
                this.saveCurrentThread();
                return;
            }
        }
        
        this.log('⚠️ Max iterations reached.');
        this.saveCurrentThread();
    }
}
