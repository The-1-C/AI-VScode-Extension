import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Thread {
    id: string;
    title: string;
    created: number;
    updated: number;
    messages: any[];
}

export interface Memory {
    facts: string[];
    updated: number;
}

export class Storage {
    private storageDir: string;
    private threadsDir: string;
    private memoryFile: string;

    constructor() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.storageDir = path.join(workspaceRoot, '.ai-agent');
        this.threadsDir = path.join(this.storageDir, 'threads');
        this.memoryFile = path.join(this.storageDir, 'memory.json');
        this.ensureDirs();
    }

    private ensureDirs() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
                console.log('[AI Agent Storage] Created storage dir:', this.storageDir);
            }
            if (!fs.existsSync(this.threadsDir)) {
                fs.mkdirSync(this.threadsDir, { recursive: true });
                console.log('[AI Agent Storage] Created threads dir:', this.threadsDir);
            }
        } catch (err) {
            console.error('[AI Agent Storage] Failed to create directories:', err);
        }
    }

    // Thread management
    generateThreadId(): string {
        return `T-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    saveThread(thread: Thread): void {
        try {
            this.ensureDirs();
            const filePath = path.join(this.threadsDir, `${thread.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify(thread, null, 2), 'utf-8');
            console.log('[AI Agent Storage] Saved thread:', thread.id);
        } catch (err) {
            console.error('[AI Agent Storage] Failed to save thread:', err);
        }
    }

    loadThread(id: string): Thread | null {
        const filePath = path.join(this.threadsDir, `${id}.json`);
        if (!fs.existsSync(filePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return null;
        }
    }

    deleteThread(id: string): boolean {
        const filePath = path.join(this.threadsDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }

    listThreads(): Thread[] {
        if (!fs.existsSync(this.threadsDir)) return [];
        const files = fs.readdirSync(this.threadsDir).filter(f => f.endsWith('.json'));
        const threads: Thread[] = [];
        for (const file of files) {
            try {
                const thread = JSON.parse(fs.readFileSync(path.join(this.threadsDir, file), 'utf-8'));
                threads.push(thread);
            } catch {}
        }
        return threads.sort((a, b) => b.updated - a.updated);
    }

    // Memory management
    loadMemory(): Memory {
        if (!fs.existsSync(this.memoryFile)) {
            return { facts: [], updated: Date.now() };
        }
        try {
            return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8'));
        } catch {
            return { facts: [], updated: Date.now() };
        }
    }

    saveMemory(memory: Memory): void {
        memory.updated = Date.now();
        fs.writeFileSync(this.memoryFile, JSON.stringify(memory, null, 2), 'utf-8');
    }

    addMemory(fact: string): void {
        const memory = this.loadMemory();
        if (!memory.facts.includes(fact)) {
            memory.facts.push(fact);
            this.saveMemory(memory);
        }
    }

    removeMemory(index: number): boolean {
        const memory = this.loadMemory();
        if (index >= 0 && index < memory.facts.length) {
            memory.facts.splice(index, 1);
            this.saveMemory(memory);
            return true;
        }
        return false;
    }

    getMemoryContext(): string {
        const memory = this.loadMemory();
        if (memory.facts.length === 0) return '';
        return '\n\nREMEMBERED CONTEXT:\n' + memory.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
    }
}
