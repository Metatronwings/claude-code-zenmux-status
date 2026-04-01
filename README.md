# claude-code-zenmux-status

[English](README.en.md)

在 Claude Code 状态栏显示 [Zenmux](https://zenmux.ai) 订阅用量、会话 token 统计和 Git 状态。

**默认模式：**
```
💎 ultra | 5h 8.1% $2.13/$26.27 ↻4h 20m | 7d 81.3% $165.13/$202.98 ↻23h 22m
📁~/project 🌿(main) ✗ ~3 ?1
```

**进度条模式（`ZENMUX_PROGRESS_BAR=1`）：**
```
[Sonnet 4.6] 💎 ▓░░░░░░░░░ 8.1% | 7d ████████░░ 81.3% | ↑9.0M ↓56k
📁~/project 🌿(main) ✗ ~3 ?1
```

### 第一行 — 订阅用量

- 档位 emoji：💎 Ultra / 🔥 Max / ⭐ Pro / 🌱 Free
- `5h` — 5 小时滚动窗口
- `7d` — 7 天滚动窗口（**仅在用量超过 70% 时显示**）
- 进度条模式下额外显示：当前模型名 `[Sonnet 4.6]`、会话累计 token `↑input ↓output`
- 账号状态异常时自动附加标记，如 `[monitored]`

### 第二行 — 工作区状态

- `📁` 当前工作目录（`~` 缩写）
- `🌿(branch)` Git 分支
- `✗` 有未提交变更时显示，后跟各类变更数：`+新增`（绿）`~修改`（黄）`?未跟踪`（红）

## 凭证获取

1. 前往 [ZenMux 控制台](https://zenmux.ai/platform/management)
2. 创建一个 **Management API Key**
3. 复制 Key 备用

## 安装方式

### 方式一：npm 全局安装

```bash
npm install -g @metatronwings/claude-code-zenmux-status
```

在 `.claude/settings.local.json` 里配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_MANAGEMENT_API_KEY=your_key_here claude-code-zenmux-status"
  }
}
```

开启进度条模式：

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_PROGRESS_BAR=1 ZENMUX_MANAGEMENT_API_KEY=your_key_here claude-code-zenmux-status"
  }
}
```

也可以在 `~/.zshrc` / `~/.bashrc` 里 `export ZENMUX_MANAGEMENT_API_KEY=...`，command 直接写 `claude-code-zenmux-status`。

### 方式二：本地克隆运行

```bash
git clone https://github.com/Metatronwings/claude-code-zenmux-status.git
cd claude-code-zenmux-status
npm install
```

在 `.claude/settings.local.json` 里：

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_MANAGEMENT_API_KEY=your_key_here /path/to/node_modules/.bin/tsx /path/to/src/index.ts"
  }
}
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ZENMUX_MANAGEMENT_API_KEY` | ✅ | Management API Key |
| `ZENMUX_PROGRESS_BAR` | 否 | 设为 `1` 启用进度条模式 |
| `ZENMUX_CACHE_TTL` | 否 | 缓存秒数，默认 `60` |

## 缓存

Claude Code 状态栏在每次 AI 回复后触发刷新，频繁对话时每分钟可能执行多次。为避免触达 API 限流，工具内置文件缓存：

- 默认 TTL **60 秒**，缓存命中时响应 < 30ms
- 缓存文件：`/tmp/czs-<key_hash>.cache`（key 的 sha256 前 16 位，不含明文）
- Git 状态、当前目录、会话 token 每次实时读取，不走缓存

## 时间计算

所有倒计时以 API 响应的 `Date` 头作为当前时间基准，不依赖本地系统时钟，在任何时区和时钟偏差环境下均能正确显示。
