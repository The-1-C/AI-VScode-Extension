# AI Coding Agent for VS Code

A local LLM-powered coding agent that runs inside VS Code. Works with LM Studio, Ollama, or any OpenAI-compatible API.

## Features

- 🤖 **AI Chat Panel** - Sidebar chat interface like GitHub Copilot
- 🔧 **Tool Use** - Agent can read, write, search files, and run commands
- 💾 **Persistent Memory** - Remembers context across sessions
- 📝 **Chat Threads** - Save and switch between conversations
- ⚡ **Local & Private** - Runs entirely on your machine

## Quick Install

### Option 1: Run install script
```powershell
# PowerShell
.\install.ps1
```
```batch
# Command Prompt
install.bat
```

### Option 2: Manual install
```bash
npm install
npm run compile
npx vsce package --no-dependencies
code --install-extension ai-agent-0.0.1.vsix --force
```

### Option 3: Development mode
Press **F5** in VS Code to launch extension in debug mode.

## Setup

1. **Install LM Studio** from https://lmstudio.ai
2. **Download a model** that supports tool calling:
   - Qwen 2.5 (recommended)
   - Llama 3.1 / 3.2
   - Mistral / Mixtral
3. **Start the server** in LM Studio (default port: 1234)
4. **Open AI Agent** with `Ctrl+Shift+A` or click the robot icon in sidebar

## Usage

### Chat Panel
- **Ctrl+Shift+A** - Focus chat panel
- **+** button - New conversation
- **🗑** button - Delete conversation
- **⏹** button - Stop generation
- **⚙** button - Open settings

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Open chat panel |
| `Ctrl+Shift+F` | Fix current file |
| `Ctrl+Shift+E` | Explain selection |
| `Ctrl+Shift+R` | Refactor selection |

### Context Menu (right-click in editor)
- **Ask About Selection** - Ask AI about highlighted code
- **Explain Selection** - Get detailed explanation
- **Refactor Selection** - Improve code quality
- **Generate Tests** - Create unit tests
- **Add Documentation** - Add JSDoc/docstrings
- **Fix Current File** - Auto-fix errors

### Source Control
- **Generate Commit Message** - AI writes commit message from staged diff

### Agent Tools
The AI can use these tools:
- `list_files` / `read_file` / `write_file` / `delete_file`
- `search_files` - Search text across files
- `get_active_file` - Get current editor content
- `get_selection` / `replace_selection` / `insert_text`
- `get_diagnostics` - Get VS Code errors/warnings
- `run_command` - Execute shell commands
- `remember` / `recall` / `forget` - Persistent memory
- `undo` - Undo last file change
- `git_status` / `git_diff` / `git_log` - Git integration

## Safety Features

- **Path protection** - Cannot access files outside workspace or .git
- **Dangerous command blocking** - Blocks rm -rf, format, etc.
- **File size limits** - Won't read files over 1MB
- **Backup before write** - Automatic backups in `.ai-agent/backups/`
- **Optional confirmation** - Enable `confirmBeforeWrite` to approve changes
- **Undo support** - Agent can undo its last file change

## Settings

Open settings with **⚙** button or `Ctrl+,` → search "ai-agent"

| Setting | Default | Description |
|---------|---------|-------------|
| `apiUrl` | `http://127.0.0.1:1234/v1/chat/completions` | LLM API endpoint |
| `model` | `local-model` | Model name |
| `temperature` | `0.1` | Creativity (0-2) |
| `maxTokens` | `4096` | Max response tokens |
| `timeout` | `120000` | Request timeout (ms) |
| `autoSave` | `true` | Auto-save chat threads |
| `showToolCalls` | `true` | Show tool usage in chat |
| `systemPromptAddition` | `""` | Custom instructions |
| `confirmBeforeWrite` | `false` | Ask before writing files |
| `backupBeforeWrite` | `true` | Backup files before overwriting |
| `autoFixOnSave` | `false` | Offer to fix errors on save |
| `includeContext` | `true` | Auto-include current file in requests |

### Using with Other Providers

**Ollama:**
```
API URL: http://localhost:11434/v1/chat/completions
Model: llama3.1
```

**OpenAI:**
```
API URL: https://api.openai.com/v1/chat/completions
Model: gpt-4
```
(Set `OPENAI_API_KEY` environment variable)

## Data Storage

All data is stored in `.ai-agent/` in your workspace:
- `threads/` - Saved conversations
- `memory.json` - Persistent memory

## Troubleshooting

**"API Error: fetch failed"**
- Ensure LM Studio server is running on port 1234

**Agent doesn't use tools**
- Use a model that supports function calling (Qwen, Llama 3.1+)

**Slow responses**
- Try a smaller model or increase timeout in settings

## License

MIT
