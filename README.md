# Advanced Mineflayer Bot — Capabilities & Commands 🔧

This repository contains a modular Mineflayer bot with support for command-based tasks (collect, mine, build, fight/pvp, "build an empire", and higher-level goals like "beat the game"/speedrun), and an extensible trainer scaffold that can be used to evolve or improve policies over time.

---

## TL;DR ✅
- Run the bot: `node bot.js --host <host> --port <port> --username <BotName>`
- In chat, direct the bot using `!` commands, e.g. `!collect diamond`, `!mine`, `!build house`, `!empire`, `!speedrun`.
- Start training (local/neat) with: `npm run train` (see trainer config in `train/neuroevolve.js`).

---

## Commands (in-game or via console)
Command format: start a message with `!` to issue a command to the bot. Example: `!collect iron_ingot`

- `!collect <ITEM>` 🔍
  - Purpose: locate and pick up the requested item from nearby ground or containers.
  - Behavior: uses pathfinding to navigate to the nearest instance of the item and pick it up. If not found, attempts basic search heuristics (nearby chests, surface mobs that drop it).
  - Usage: you can pass an amount: `!collect <ITEM> <amount>` — the bot will attempt to pick up that many items before finishing.

- `!mine [<BLOCK>|auto]` ⛏️
  - Purpose: mine blocks. `auto` lets the bot determine useful resources (stone/coal/iron depending on tool and world progress).
  - Behavior: uses pathfinding to approach target blocks and the bot's digging API to break them, with inventory management and tool checks (stubbed, configurable).
  - Usage: you can pass an amount to mine multiple blocks: `!mine <BLOCK|auto> <amount>` — the bot will mine up to that many matching blocks.

- `!build <blueprint>` 🧱
  - Purpose: place blocks according to a simple blueprint or template (e.g., `house`, `farm`, `wall`).
  - Behavior: finds/builds a flat area, **sources blocks from inventory or nearby chests (auto-refill)**, and executes a placement plan. Blueprints are pluggable JSON patterns.

- `!fight <TARGET|nearest>` ⚔️
  - Purpose: engage a specified entity (player/mob) or the nearest threat for PvP/combat practice.
  - Behavior: basic combat loop with pathfinding, sprint/chase, weapon swapping, and simple cooldown/retreat logic.

- `!empire` 🏰
  - Purpose: high-level orchestration: build a base, set up farms, collect resources, and create a villager trading hall.
  - Behavior: this is a composite task that calls mining/collecting/building/auto-farming modules and coordinates them via a planner module (long-running task).

- `!speedrun` / `!beat the game` 🏁
  - Purpose: attempt an end-to-end goal (e.g., beat the Ender Dragon / speedrun objectives). This is *experimental* and requires a lot of game knowledge and potentially manual configuration.
  - Behavior: uses task planner + pathing + resource heuristics; success may need human-tuned strategies and training.

- `!train start|status|stop` 🧠
  - Purpose: control the local neuroevolution trainer (see `train/neuroevolve.js`). `start` runs training, `status` prints progress, `stop` requests a graceful halt.

- `!learn start|stop|status` 🧠🔥
  - Purpose: run continuous learning — starts the trainer in continuous mode and autodeploys improved models to the bot when they are saved.
  - Behavior: `!learn start` launches the trainer (`CONTINUOUS=1`) in the background and enables automatic model watching; when `models/best-latest.json` is updated the bot reloads the model and attempts to start a live controller. `!learn stop` halts the trainer and disables autodeploy. `!learn status` shows trainer and watcher state.

---

## Architecture & Extensibility 🔧
- `bot.js` — main entry point and command parsing. Accepts CLI args (host, port, username, password, version).
- `modules/tasks/` — task implementations (collect, mine, build, pvp, empire, speedrun). Each module exports functions with a clear API: `run(bot, args, options)` returning a Promise.
- `train/neuroevolve.js` — a trainer scaffold (example uses `neataptic`) to evolve neural policies for task subproblems. Saves best models to `models/` automatically.
- `models/` — saved best networks or policy weights (JSON)

Note: modules are shipped as stubs/proofs-of-concept to give a working skeleton — these need iterative improvement and test harnesses to become robust.

---

## Running & Testing 💡
1. Install dependencies:
```bash
npm install
```
2. Add optional dependencies for advanced modules (pathfinder, extra plugins):
```bash
npm install mineflayer-pathfinder neataptic
```

Optional PvP plugin
```bash
# install the optional PvP helper for improved combat behaviour
npm install mineflayer-pvp
```

Note: the `mineflayer-pvp` module is optional. If it is not installed the bot will still run and the `!fight`/`!pvp` command will fall back to a simpler built-in combat loop. Installing `mineflayer-pvp` enables more advanced combat tactics.
3. Run the bot and send commands from a Minecraft client or type commands directly into the bot process' stdin.

---

## Training & Limitations ⚠️
- The trainer includes a working **Collect** environment (a small gridworld) and additional toy simulators (`mine`, `build`, `pvp`) for multi-task experiments. Run `npm run train:collect` or `TASKS=collect,mine node train/neuroevolve.js` to train on the selected tasks — the script evaluates networks on several episodes each generation, seeds from prior best models if available, and auto-saves improved models to `models/` (see `models/fitness.log` for progress).

- Integration: run `npm run test:integration:local` to auto-download a PaperMC server, accept the EULA, launch a local server, then run the integration task suite and tear down the server (requires Java and internet access).

- **Continuous & resumable training**: use `CONTINUOUS=1 node train/neuroevolve.js` to let the trainer run continuously until you stop it (Ctrl-C). The trainer writes full-population checkpoints (`checkpoint-full-gen-*.json` and `checkpoint-full-latest.json`) each generation; if a full checkpoint is present on startup the trainer will resume the population and continue training from the saved generation.

-- **Auto-load & model persistence**: configure a persisted model path with `!persist set <path> [watch] [autostart]` (in-game or stdin). The bot will attempt to load the persisted model at startup; if you specified `watch`, it will auto-reload when the file changes; if you specified `autostart`, the bot will attempt to run the model controller automatically on spawn. You can also manually `!load <path>` (alias `!l`) or `!watch start <path>` / `!watch stop` (alias `!w`). To start a live model-driven collect loop manually: `!collect model`. To stop it: `!stopc`.

- **Global stop**: use `!end`, `!stop`, or `!stopall` to request cancellation of any running task (mine/collect/build/pvp/empire/speedrun). This will also attempt to stop live model controllers and the trainer process when possible.

- **Auth refresh**: you can manually refresh stored Microsoft tokens with `!auth refresh` (or run `npm run auth:refresh`). The refresh helper now tries the broader `common` tenant endpoint and falls back to consumer/legacy endpoints when appropriate for improved compatibility. Enable periodic refresh with `!auth autorefresh start` and disable with `!auth autorefresh stop`. Persist that setting across restarts with `!persist set <path> [watch] [autostart]` and `!auth autorefresh start`.

- Models are saved as `best-latest.json` whenever a new best is found and periodic `checkpoint-gen-*.json` files are written to support resuming.

- Per-task model manager: the trainer now saves per-task best candidates into `models/<task>/` (e.g. `models/mine/`, `models/pvp/`). The system keeps the top-ranked candidates per task and prunes older/worse files to conserve storage. Use these for focused improvement (train with `TASKS=mine` to continue training a mining specialist).


- Important caveats:
  - The current trainer demonstrates **learning on a small simulated task** (collecting items in a grid). This proves the workflow — networks do improve on the toy task, but that does not immediately transfer to real Minecraft world performance.
  - To train a full Minecraft-capable agent you need a proper environment (or many real episodes on a server), carefully designed reward functions per subtask (collecting, building, fighting), and substantial compute/time.
  - Integrating a trained policy into live bot behavior requires mapping game observations (block positions, entity lists, inventory state) to the policy's observation vector and mapping the policy's outputs to safe, high-level actions. This adapter is partially scaffolded (`modules/policy/nn_policy.js`), and the `collect` task demonstrates a simulator-only model demo.

- Safety & reliability: automated training can produce unexpected behaviors; always test policies in controlled environments (local server, sandbox worlds) and use human oversight.

---

## Microsoft account auth & Aternos deployment 🔐

Aternos servers run in online-mode and require a Microsoft/Xbox Live authenticated account for clients. This repository supports two workflows:

**1) Device-code OAuth (automatic, recommended)**
- Install the new dependency and run the helper: `npm install` then `npm run auth:device` (or `node auth/device_flow.js`). This helper now uses **MSAL** (`@azure/msal-node`) for a more robust device-code flow across consumer and organizational accounts; it will print a URL and code — open it in your browser and follow the instructions.
- The helper exchanges the device code for an access token (and refresh token when available), performs the Xbox Live/XSTS exchange, fetches your Minecraft profile and `mcAccessToken`, and writes `auth.json` into the project root.
- `bot.js` will automatically read `auth.json` on spawn and use the stored `mcAccessToken` to authenticate with online servers.

>If the device flow still fails in your environment, the helper falls back to legacy endpoints; as a final manual option you can run `node auth/save_tokens.js` to paste tokens manually into `auth.json` (see the Manual token saving section).

**2) Manual token saving (quick alternative)**
- Use the interactive saver: `node auth/save_tokens.js` and paste `accessToken` and `refreshToken` (if you have them).
- The file `auth.json` will be written and used by the bot.

Example `auth.json` schema (if you need to paste tokens manually):

```json
{
  "method": "microsoft",
  "accessToken": "<ms_access_token>",
  "refreshToken": "<refresh_token_optional>",
  "mcAccessToken": "<minecraft_access_token>",
  "profile": { "id": "<uuid>", "name": "YourMinecraftName" }
}
```

If you only have an `mcAccessToken` and profile, that is sufficient for the bot to join online-mode servers until the token expires. Use `npm run auth:refresh` or re-run `npm run auth:device` to refresh tokens.

Security & notes:
- Keep `auth.json` private and never commit it. `.gitignore` already excludes it.
- Tokens may expire; re-run the device flow to refresh.
- If the helper cannot obtain `mcAccessToken` automatically, I can add a full OAuth helper or integrate libraries like `prismarine-auth` to automate refreshes.

---

## Deploying & connecting to your Aternos server ▶️
Important: you run this bot on your PC or a VPS and it connects to your Aternos server like a normal player — you cannot run arbitrary background processes on Aternos directly.

1. Start your Aternos server and copy its IP/port.
2. Ensure the server whitelist/op settings permit the bot's username (add to whitelist or /op if needed).
3. Ensure you have valid Microsoft credentials (use `npm run auth:device` to obtain them and save to `auth.json`).
4. Run the bot locally or on a reachable machine:

```bash
node bot.js --host <aternos-host> --port <port> --username <BotName>
```

5. Control the bot in-game or via stdin: `!loadmodel models/best-latest.json`, `!collect model`, `!persistmodel set models/best-latest.json watch autostart`, etc.

If you want, I can add: OAuth refresh automation, a small systemd/service script for VPS deployment, or an interactive checklist and troubleshooting steps for your Aternos server. Which would you like next?

Quick troubleshooting
- **Cannot find module 'mineflayer-pvp'**: run `npm install mineflayer-pvp` to add the optional PvP plugin, or leave it uninstalled — the bot will still start but PvP will use a simpler fallback. 
- **npm install fails (ETARGET)**: try removing or pinning problematic packages in `package.json` and rerun `npm install`. I already removed `@azure/msal-node` from dependencies to avoid a common ETARGET issue; add a compatible MSAL version only when you need the device-code helper.

---

## Contributing
If you want specific features (example: robust villager trading hall builder, automated farms, a more advanced PvP agent, or integration with external RL in Python), tell me which piece you want next and I'll add it.

---

## License
MIT — See `package.json` for details.
