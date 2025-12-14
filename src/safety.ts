import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileChange {
    path: string;
    oldContent: string | null;
    newContent: string;
    timestamp: number;
}

export class Safety {
    private workspaceRoot: string;
    private backupDir: string;
    private changeHistory: FileChange[] = [];
    private maxHistorySize = 50;
    private maxFileSize = 1024 * 1024; // 1MB

    private dangerousCommands = [
        /^rm\s+(-rf?|--recursive).*[\/\\]$/i,
        /^rm\s+-rf?\s*[\/\\]$/i,
        /^del\s+[\/\\]\*|^del\s+\*\.\*/i,
        /^format\s+[a-z]:/i,
        /^mkfs/i,
        /^dd\s+.*of=/i,
        /^:\(\)\s*\{\s*:\|:\s*&\s*\}/,  // Fork bomb
        /^chmod\s+(-R\s+)?777\s+[\/\\]/i,
        /^chown\s+-R.*[\/\\]$/i,
        />\s*\/dev\/sd[a-z]/i,
        /^shutdown/i,
        /^reboot/i,
        /^halt/i,
        /^init\s+[06]/i,
        /^pkill\s+-9\s+-1/i,
        /^killall\s+-9/i,
        /^taskkill\s+\/f\s+\/im\s+\*/i,
        /\|\s*sh\s*$/i,  // Piping to shell
        /\|\s*bash\s*$/i,
        /curl.*\|\s*(ba)?sh/i,  // Curl pipe to shell
        /wget.*\|\s*(ba)?sh/i,
    ];

    private sensitivePatterns = [
        /password\s*[:=]/i,
        /api[_-]?key\s*[:=]/i,
        /secret\s*[:=]/i,
        /token\s*[:=]/i,
        /private[_-]?key/i,
        /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
        /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,
    ];

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.backupDir = path.join(workspaceRoot, '.ai-agent', 'backups');
    }

    isPathSafe(filePath: string): { safe: boolean; reason?: string } {
        const resolved = path.resolve(filePath);
        const relative = path.relative(this.workspaceRoot, resolved);
        
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return { safe: false, reason: 'Path is outside workspace' };
        }

        const dangerous = ['.git', 'node_modules/.bin', '.env', '.env.local', '.env.production'];
        for (const pattern of dangerous) {
            if (relative.startsWith(pattern) || relative.includes(`/${pattern}`) || relative.includes(`\\${pattern}`)) {
                if (pattern === '.git') {
                    return { safe: false, reason: 'Cannot modify .git directory' };
                }
            }
        }

        return { safe: true };
    }

    isCommandSafe(cmd: string): { safe: boolean; reason?: string } {
        const trimmed = cmd.trim();
        
        for (const pattern of this.dangerousCommands) {
            if (pattern.test(trimmed)) {
                return { safe: false, reason: `Blocked dangerous command pattern` };
            }
        }

        return { safe: true };
    }

    checkFileSize(filePath: string): { ok: boolean; size?: number; reason?: string } {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > this.maxFileSize) {
                return { 
                    ok: false, 
                    size: stats.size, 
                    reason: `File too large (${(stats.size / 1024 / 1024).toFixed(2)}MB > 1MB limit)` 
                };
            }
            return { ok: true, size: stats.size };
        } catch {
            return { ok: true };
        }
    }

    async backupFile(filePath: string): Promise<string | null> {
        if (!fs.existsSync(filePath)) return null;
        
        try {
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }

            const timestamp = Date.now();
            const relative = path.relative(this.workspaceRoot, filePath);
            const backupName = `${timestamp}-${relative.replace(/[\/\\]/g, '_')}`;
            const backupPath = path.join(this.backupDir, backupName);
            
            fs.copyFileSync(filePath, backupPath);
            return backupPath;
        } catch (e) {
            console.error('Backup failed:', e);
            return null;
        }
    }

    recordChange(filePath: string, oldContent: string | null, newContent: string) {
        this.changeHistory.push({
            path: filePath,
            oldContent,
            newContent,
            timestamp: Date.now()
        });

        if (this.changeHistory.length > this.maxHistorySize) {
            this.changeHistory.shift();
        }
    }

    getLastChange(): FileChange | null {
        return this.changeHistory[this.changeHistory.length - 1] || null;
    }

    undoLastChange(): { success: boolean; message: string } {
        const last = this.changeHistory.pop();
        if (!last) {
            return { success: false, message: 'No changes to undo' };
        }

        try {
            if (last.oldContent === null) {
                if (fs.existsSync(last.path)) {
                    fs.unlinkSync(last.path);
                    return { success: true, message: `Deleted newly created file: ${last.path}` };
                }
            } else {
                fs.writeFileSync(last.path, last.oldContent, 'utf-8');
                return { success: true, message: `Restored: ${last.path}` };
            }
            return { success: true, message: 'Undo complete' };
        } catch (e: any) {
            return { success: false, message: `Undo failed: ${e.message}` };
        }
    }

    generateDiff(oldContent: string, newContent: string, filePath: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const diff: string[] = [`--- ${filePath}`, `+++ ${filePath}`];
        
        let i = 0, j = 0;
        while (i < oldLines.length || j < newLines.length) {
            if (i >= oldLines.length) {
                diff.push(`+${newLines[j]}`);
                j++;
            } else if (j >= newLines.length) {
                diff.push(`-${oldLines[i]}`);
                i++;
            } else if (oldLines[i] === newLines[j]) {
                diff.push(` ${oldLines[i]}`);
                i++;
                j++;
            } else {
                let foundMatch = false;
                for (let k = 1; k <= 3; k++) {
                    if (i + k < oldLines.length && oldLines[i + k] === newLines[j]) {
                        for (let m = 0; m < k; m++) {
                            diff.push(`-${oldLines[i + m]}`);
                        }
                        i += k;
                        foundMatch = true;
                        break;
                    }
                    if (j + k < newLines.length && oldLines[i] === newLines[j + k]) {
                        for (let m = 0; m < k; m++) {
                            diff.push(`+${newLines[j + m]}`);
                        }
                        j += k;
                        foundMatch = true;
                        break;
                    }
                }
                if (!foundMatch) {
                    diff.push(`-${oldLines[i]}`);
                    diff.push(`+${newLines[j]}`);
                    i++;
                    j++;
                }
            }
        }

        const filteredDiff = diff.filter((line, idx) => {
            if (idx < 2) return true;
            if (!line.startsWith(' ')) return true;
            const nearby = diff.slice(Math.max(2, idx - 2), Math.min(diff.length, idx + 3));
            return nearby.some(l => l.startsWith('+') || l.startsWith('-'));
        });

        return filteredDiff.slice(0, 50).join('\n') + (filteredDiff.length > 50 ? '\n... (truncated)' : '');
    }

    async confirmWrite(filePath: string, newContent: string): Promise<boolean> {
        const exists = fs.existsSync(filePath);
        const oldContent = exists ? fs.readFileSync(filePath, 'utf-8') : '';
        
        let message: string;
        if (!exists) {
            message = `Create new file: ${path.basename(filePath)}?`;
        } else {
            const diff = this.generateDiff(oldContent, newContent, filePath);
            const lineCountOld = oldContent.split('\n').length;
            const lineCountNew = newContent.split('\n').length;
            message = `Modify ${path.basename(filePath)}? (${lineCountOld} → ${lineCountNew} lines)\n\nPreview:\n${diff.slice(0, 500)}`;
        }

        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            'Apply',
            'Cancel'
        );

        return result === 'Apply';
    }
}
