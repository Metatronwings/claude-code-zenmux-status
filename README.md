# claude-code-zenmux-status

[English](README.en.md)

在 Claude Code 状态栏显示 [Zenmux](https://zenmux.ai) 订阅用量。

```
⚡ ultra | 7d 13.8% $27.95/$202.98 ↻4d 5h | 5h 24.8% $6.52/$26.27 ↻43m
```

- `7d` — 7 天滚动窗口：已用比例、已花费/上限（USD）、距重置时间
- `5h` — 5 小时滚动窗口：已用比例、已花费/上限（USD）、距重置时间
- 账号状态异常时自动显示标记，如 `⚡ ultra [monitored]`

## 凭证获取

1. 前往 [ZenMux 控制台](https://zenmux.ai/platform/management)
2. 创建一个 **Management API Key**
3. 复制 Key 备用

## 安装方式

### 方式一：npm 全局安装

```bash
npm install -g @metatronwings/claude-code-zenmux-status
```

在 Claude Code 的 `.claude/settings.local.json` 里配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "ZENMUX_MANAGEMENT_API_KEY=your_key_here claude-code-zenmux-status"
  }
}
```

也可以在 `~/.zshrc` / `~/.bashrc` 里 `export ZENMUX_MANAGEMENT_API_KEY=...`，command 直接写 `claude-code-zenmux-status`。

### 方式二：本地克隆运行

```bash
git clone https://github.com/Metatronwings/claude-code-zenmux-status.git
cd claude-code-zenmux-status
npm install
npm run build      # 可选，构建后启动更快
echo "ZENMUX_MANAGEMENT_API_KEY=your_key_here" > .env
```

在 `.claude/settings.local.json` 里：

```json
{
  "statusLine": {
    "type": "command",
    "command": "/absolute/path/to/claude-code-zenmux-status/status.sh"
  }
}
```

`status.sh` 自动加载 `.env`，优先用编译后的 `dist/index.js`，否则回退到 `tsx`。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ZENMUX_MANAGEMENT_API_KEY` | ✅ | Management API Key |
| `ZENMUX_CACHE_TTL` | 否 | 缓存秒数，默认 `60` |

## 缓存

Claude Code 状态栏在每次 AI 回复后触发刷新，频繁对话时每分钟可能执行多次。为避免触达 API 限流，工具内置文件缓存：

- 默认 TTL **60 秒**，缓存命中时响应 < 30ms
- 缓存文件：`/tmp/czs-<key_hash>.cache`（key 的 sha256 前 16 位，不含明文）
- 缓存读写失败时静默忽略，自动回退到实时请求

## 时间计算

所有倒计时以 API 响应的 `Date` 头作为当前时间基准，不依赖本地系统时钟，在任何时区和时钟偏差环境下均能正确显示。

## 发布

在 GitHub 上创建 Release，GitHub Actions 会自动构建并发布到 npm。

## 手动测试

```bash
npm run status          # 开发模式（tsx，无需先 build）
node dist/index.js      # 测试构建产物（需先 npm run build）
```
