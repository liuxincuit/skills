# Auto-Prepend Pi Extension Design

## Overview

A Pi extension that automatically injects a configurable custom message (system instruction level) after N rounds of conversation. After the threshold is reached, the next user question triggers the injection, and the counter resets.

## Motivation

When working with AI coding agents, it's useful to periodically inject contextual instructions without manually typing them. For example, after every 7 rounds, remind the agent to "请详细解释你的推理过程" (explain your reasoning in detail).

## Configuration

**File:** `~/.pi/agent/auto-prepend.json`

```json
{
  "enabled": true,
  "interval": 7,
  "message": "请详细解释你的推理过程"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the extension |
| `interval` | number | `7` | Number of assistant rounds after which to trigger |
| `message` | string | `"请详细解释你的推理过程"` | Custom message to inject |

Config file is read on each `before_agent_start`. If the file is missing or malformed, defaults are used.

## Behavior

### Event Flow

```
session_start
  └─ scan session history: count existing assistant messages
     → roundCount = count % interval

[user sends message]
  → input event (pass through, no transformation)
  → before_agent_start
       ├─ if roundCount >= interval:
       │     → inject message (customType: "auto-prepend")
       │     → roundCount = 0
       │     → save roundCount to config file (for session-restart persistence)
       └─ else: pass through
  → agent processes
  → agent_end → roundCount++

[pi -r session restore]
  → session_start → scan history → rebuild roundCount
```

### Counter Reset on Session Restore

When resuming a session via `pi -r`, the extension scans `ctx.sessionManager.getBranch()` for entries where `role === "assistant"`. The counter is set to `count % interval`, so from the user's perspective, the threshold is consistent across the entire session lifetime.

### Injected Message

- Injected via `before_agent_start` return value's `message` field
- `customType: "auto-prepend"` — typed as a custom message
- `content: config.message` — user-configured static string
- `display: true` — visible in TUI

The custom message does NOT count toward the assistant message counter (it's not an assistant message), preventing recursive/runaway injection.

### Counter Persistence

To handle the case where Pi exits normally and restarts (not via `-r` but a brand new session), the counter is ephemeral — it resets per-session start. For `-r` resumes, session history rebuilds the counter accurately.

Additionally, after each injection, the current `roundCount` is persisted to the config file under a `_state` key, so even if the process crashes before the next `agent_end`, the counter state is not lost:

```json
{
  "enabled": true,
  "interval": 7,
  "message": "请详细解释你的推理过程",
  "_state": {
    "roundCount": 3
  }
}
```

## Implementation

### File Structure

```
~/.pi/agent/extensions/
└── auto-prepend.ts
~/.pi/agent/
└── auto-prepend.json        (auto-created with defaults if missing)
```

### Extension API Usage

| Event | Purpose |
|-------|---------|
| `session_start` | Scan session history to initialize roundCount |
| `agent_end` | Increment roundCount; persist to config file |
| `before_agent_start` | Check threshold, inject message if needed |

### Commands

- `/auto-prepend status` — Show enabled/disabled, interval, message, current roundCount, and "X more rounds until next injection"
- `/auto-prepend init` — Create default config file if it doesn't exist

### Edge Cases

- **Config file missing/deleted:** Use defaults (enabled, interval=7, message="请详细解释你的推理过程")
- **Config file malformed JSON:** Notify user via `ctx.ui.notify()` with warning, use defaults
- **Rapid steering messages:** Each `agent_end` increments counter, including responses to steering messages — matches "dialogue round" intuition
- **New session vs restored session:** New session → counter=0; restored session → scan history
- **Pi restart without -r:** Fresh count (counter=0)
- **Concurrent with other extensions:** No conflicts; works independently
