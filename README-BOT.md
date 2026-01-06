# Simple Mineflayer Bot 🔧

A minimal bot that connects to a Minecraft server and can interact via chat.

## Features ✅
- Connect to any server by host/port
- Send and receive chat messages
- Auto-respond to greetings
- Send chat messages from your terminal (stdin)

## Setup 💡
1. Install dependencies:

```bash
npm install
```

2. Run the bot:

```bash
node bot.js --host play.example.com --port 25565 --username MyBot
```

Options:
- `--host` or `--server` (default: `localhost`)
- `--port` (optional)
- `--username` (default: `Bot`)
- `--password` (optional; if required for auth)
- `--version` (optional; specify Minecraft protocol version)

Notes:
- To connect to a single-player world, open it to LAN or run a local server and connect to that host/port.
- Microsoft/Xbox account authentication may require extra setup; if you need that, tell me and I can add guidance.

## Usage examples
- Connect to a local server: `node bot.js --host localhost --port 25565 --username Bot`
- Connect to a server with a password: `node bot.js --host example.com --username Bot --password <password>`

If you'd like features like auto-following, pathfinding, block interaction (dig/place), or plugin-based behaviors, I can add them next. 👍
