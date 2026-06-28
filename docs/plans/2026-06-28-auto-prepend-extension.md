# Auto-Prepend Pi Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** Create a Pi extension that auto-injects a custom system-level message after N rounds of conversation.

**Architecture:** Single-file TypeScript extension (`auto-prepend.ts`) using JSON config at `~/.pi/agent/auto-prepend.json`. Uses Pi's `before_agent_start` to inject messages and `agent_end` to count rounds.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (ExtensionAPI), Node.js built-ins (`fs`, `path`)

## Global Constraints

- Single-file extension in `pi/extensions/auto-prepend.ts`
- Config file at `~/.pi/agent/auto-prepend.json` (auto-created with defaults if missing)
- Messages injected via `before_agent_start` return value's `message` field
- Counter rebuilt from session history on `session_start`
- Default interval: 7, default message: "请详细解释你的推理过程"
- `_state.roundCount` persisted to config file for crash resilience

---

### Task 1: Create the extension file

**Files:**
- Create: `pi/extensions/auto-prepend.ts`

**Interfaces:**
- Produces: Pi extension with `before_agent_start`, `agent_end`, `session_start` handlers
- Produces: `/auto-prepend status` and `/auto-prepend init` commands

- [ ] **Step 1: Write the extension file**

```typescript
import fs from "node:fs";
import path from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Config {
  enabled: boolean;
  interval: number;
  message: string;
  _state?: {
    roundCount?: number;
  };
}

const CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".pi",
  "agent",
  "auto-prepend.json",
);

const DEFAULT_CONFIG: Config = {
  enabled: true,
  interval: 7,
  message: "请详细解释你的推理过程",
};

function readConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      interval: typeof parsed.interval === "number" && parsed.interval > 0 ? parsed.interval : DEFAULT_CONFIG.interval,
      message: typeof parsed.message === "string" ? parsed.message : DEFAULT_CONFIG.message,
      _state: parsed._state,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeState(roundCount: number): void {
  try {
    const config = readConfig();
    const raw = JSON.stringify(
      { ...config, _state: { roundCount } },
      null,
      2,
    );
    fs.writeFileSync(CONFIG_PATH, raw, "utf-8");
  } catch {
    // Silently fail — non-critical
  }
}

function ensureConfigExists(): boolean {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const dir = path.dirname(CONFIG_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function autoPrepend(pi: ExtensionAPI) {
  let config: Config = readConfig();
  let roundCount = 0;

  // Rebuild from persisted state
  if (config._state?.roundCount !== undefined && Number.isInteger(config._state.roundCount)) {
    roundCount = config._state.roundCount;
  }

  // ── Session start: rebuild counter from history ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    config = readConfig();

    // Rebuild from persisted state first
    if (config._state?.roundCount !== undefined && Number.isInteger(config._state.roundCount)) {
      roundCount = config._state.roundCount;
    } else {
      roundCount = 0;
    }

    // If there's existing session history, use it to refine the count
    try {
      const entries = ctx.sessionManager.getBranch();
      let assistantCount = 0;
      for (const entry of entries) {
        if (
          entry.type === "message" &&
          (entry as { role?: string }).role === "assistant"
        ) {
          assistantCount++;
        }
      }
      roundCount = (roundCount + assistantCount) % config.interval;
    } catch {
      // Session manager may not be available in all contexts
    }
  });

  // ── Before agent starts: inject message if threshold reached ────────────
  pi.on("before_agent_start", async (event, ctx) => {
    if (!config.enabled) return;

    if (roundCount >= config.interval) {
      roundCount = 0;
      writeState(0);

      return {
        message: {
          customType: "auto-prepend",
          content: config.message,
          display: true,
        },
      };
    }
  });

  // ── Agent end: increment counter ────────────────────────────────────────
  pi.on("agent_end", async () => {
    if (!config.enabled) return;
    roundCount++;
    writeState(roundCount);
  });

  // ── Command: status ────────────────────────────────────────────────────
  pi.registerCommand("auto-prepend", {
    description:
      "Show auto-prepend status and config. Usage: /auto-prepend status, /auto-prepend init",
    handler: async (args, ctx) => {
      const trimmed = args.trim().toLowerCase();
      const parts = trimmed.split(/\s+/);
      const subcmd = parts[0];

      if (subcmd === "init") {
        if (ensureConfigExists()) {
          ctx.ui.notify(`Created default config at ${CONFIG_PATH}`, "info");
        } else {
          ctx.ui.notify(`Config already exists at ${CONFIG_PATH}`, "info");
        }
        return;
      }

      // Default: status
      config = readConfig();
      const nextIn = config.interval - (roundCount % config.interval);
      ctx.ui.notify(
        `auto-prepend: ${config.enabled ? "enabled" : "disabled"} | ` +
        `interval: ${config.interval} | ` +
        `current: ${roundCount} | ` +
        `next injection in ${nextIn} round(s) | ` +
        `message: "${config.message}"`,
        "info",
      );
    },
  });
}
```

- [ ] **Step 2: Verify the extension loads**

Run: `pi --no-session -e ./pi/extensions/auto-prepend.ts -p "ping"`

Expected: Pi should start and respond (no errors about the extension). The extension is passive — it won't do anything on first run since roundCount starts at 0.

- [ ] **Step 3: Test the config file is created (if manual)**

Since `/auto-prepend init` is an interactive command, verify by checking the config path exists after first manual `pi` session where user runs `/auto-prepend init`.
