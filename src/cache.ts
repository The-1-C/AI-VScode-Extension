import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl: number;
}

export class Cache {
    private cache = new Map<string, CacheEntry<any>>();
    private fileIndex: Map<string, string[]> = new Map();
    private projectTree: string = '';
    private projectTreeTimestamp = 0;
    private workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.setupFileWatcher();
        this.buildFileIndex();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        const invalidate = (uri: vscode.Uri) => {
            const rel = path.relative(this.workspaceRoot, uri.fsPath);
            this.cache.delete(`file:${rel}`);
            this.cache.delete(`outline:${rel}`);
            this.projectTreeTimestamp = 0; // Invalidate tree
        };

        this.fileWatcher.onDidChange(invalidate);
        this.fileWatcher.onDidCreate((uri) => {
            invalidate(uri);
            this.addToIndex(uri.fsPath);
        });
        this.fileWatcher.onDidDelete((uri) => {
            invalidate(uri);
            this.removeFromIndex(uri.fsPath);
        });
    }

    // Generic cache methods
    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.value as T;
    }

    set<T>(key: string, value: T, ttlMs: number = 60000): void {
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl: ttlMs
        });
    }

    invalidate(pattern: string): void {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    // File content cache
    getFile(filePath: string): string | null {
        const key = `file:${path.relative(this.workspaceRoot, filePath)}`;
        const cached = this.get<{ content: string; mtime: number }>(key);
        
        if (cached) {
            try {
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs === cached.mtime) {
                    return cached.content;
                }
            } catch {
                return null;
            }
        }
        return null;
    }

    setFile(filePath: string, content: string): void {
        try {
            const stats = fs.statSync(filePath);
            const key = `file:${path.relative(this.workspaceRoot, filePath)}`;
            this.set(key, { content, mtime: stats.mtimeMs }, 300000); // 5 min TTL
        } catch {}
    }

    // Project tree cache
    getProjectTree(): string | null {
        if (Date.now() - this.projectTreeTimestamp < 30000) { // 30 sec TTL
            return this.projectTree;
        }
        return null;
    }

    setProjectTree(tree: string): void {
        this.projectTree = tree;
        this.projectTreeTimestamp = Date.now();
    }

    // File index for fast search
    private buildFileIndex(): void {
        this.fileIndex.clear();
        this.indexDirectory(this.workspaceRoot);
    }

    private indexDirectory(dir: string): void {
        const ignoreDirs = ['.git', 'node_modules', '.ai-agent', 'out', 'dist', '__pycache__', '.next', 'vendor'];
        
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
                if (ignoreDirs.includes(entry.name)) continue;
                
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    this.indexDirectory(fullPath);
                } else {
                    this.addToIndex(fullPath);
                }
            }
        } catch {}
    }

    private addToIndex(filePath: string): void {
        const name = path.basename(filePath).toLowerCase();
        const existing = this.fileIndex.get(name) || [];
        if (!existing.includes(filePath)) {
            existing.push(filePath);
            this.fileIndex.set(name, existing);
        }
    }

    private removeFromIndex(filePath: string): void {
        const name = path.basename(filePath).toLowerCase();
        const existing = this.fileIndex.get(name);
        if (existing) {
            const idx = existing.indexOf(filePath);
            if (idx >= 0) {
                existing.splice(idx, 1);
                if (existing.length === 0) {
                    this.fileIndex.delete(name);
                }
            }
        }
    }

    // Fast file search by name
    findFiles(query: string): string[] {
        const lowerQuery = query.toLowerCase();
        const results: string[] = [];
        
        for (const [name, paths] of this.fileIndex.entries()) {
            if (name.includes(lowerQuery)) {
                results.push(...paths.map(p => path.relative(this.workspaceRoot, p)));
            }
        }
        
        return results.slice(0, 50);
    }

    // Get all indexed files
    getAllFiles(): string[] {
        const all: string[] = [];
        for (const paths of this.fileIndex.values()) {
            all.push(...paths.map(p => path.relative(this.workspaceRoot, p)));
        }
        return all;
    }

    getStats(): { files: number; cacheEntries: number; cacheSize: string } {
        let size = 0;
        for (const entry of this.cache.values()) {
            size += JSON.stringify(entry.value).length;
        }
        
        return {
            files: this.getAllFiles().length,
            cacheEntries: this.cache.size,
            cacheSize: (size / 1024).toFixed(1) + ' KB'
        };
    }

    dispose(): void {
        this.fileWatcher?.dispose();
        this.cache.clear();
        this.fileIndex.clear();
    }
}
