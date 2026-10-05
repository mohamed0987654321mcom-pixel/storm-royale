# Storm Royale 🌪️

A Fortnite-style battle royale for Roblox: lobby, warm-up island, Sky Bus drop, gliders, building, loot, a shrinking storm and bots. Managed with [Rojo](https://rojo.space).

## Layout

```
src/
├── shared/
│   └── BRConfig.luau          all tuning: weapons, storm, POIs, cosmetics, build grid
├── server/                    → ServerScriptService.Server
│   ├── GameServer.server.luau boots everything
│   └── Modules/
│       ├── Core.luau          services, remotes, shared state, saved data
│       ├── Inventory.luau     slots, ammo, materials, held item
│       ├── World.luau         island, POIs, houses, trees, lobby pads
│       ├── Loot.luau          floor loot, chests, pickups
│       ├── Building.luau      walls / floors / ramps / roofs
│       ├── Combat.luau        guns, pickaxe, damage, reload, healing
│       ├── Cosmetics.luau     outfits and gliders
│       ├── Eliminations.luau  kill credit, feed, placement
│       ├── Bots.luau          AI players
│       ├── SkyBus.luau        the bus and jumping out
│       ├── Storm.luau         storm circles and storm damage
│       ├── PlayerFlow.luau    joining, lobby, warm-up island
│       ├── Match.luau         countdown → bus → storm → winner
│       └── Remotes.luau       every client request, validated
└── client/                    → StarterPlayer.StarterPlayerScripts.Client
    ├── GameClient.client.luau boots the client + per-frame loop
    └── Modules/
        ├── Core.luau          shared state, UI + aiming helpers
        ├── Lobby.luau         menu tabs, locker, item shop, career
        ├── Hud.luau           health/shield, hotbar, minimap, feed, crosshair
        ├── Effects.luau       tracers, muzzle flash, damage numbers
        ├── Weapons.luau       shooting, pickaxe, heals
        ├── Build.luau         build preview + placement
        ├── Skydive.luau       bus jump, skydive, glider, landing
        ├── Input.luau         keyboard/mouse + touch buttons
        ├── StormFX.luau       storm wall + purple tint
        ├── CameraCtl.luau     lobby / shoulder / bus / spectate cameras
        └── Events.luau        server messages, screen changes
```

`.server.luau` → Script, `.client.luau` → LocalScript, plain `.luau` → ModuleScript.

## First-time setup (Mac)

```sh
# 1. Install Rokit (toolchain manager)
curl -sSf https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.sh | bash

# 2. In this folder, install Rojo (version pinned in rokit.toml)
cd StormRoyale
rokit install

# 3. Install the Rojo plugin into Roblox Studio
rojo plugin install
```

## Live-sync while you code

```sh
rojo serve
```

Open a new Baseplate in Studio → **Plugins** tab → **Rojo** → **Connect**. Every save in your editor syncs into Studio instantly. Press **Play** to test.

## Build a place file

```sh
rojo build -o StormRoyale.rbxlx
```

Then open `StormRoyale.rbxlx` in Studio.

## Studio settings (once per place)

- **Game Settings → Avatar** → R15
- **Game Settings → Security** → Enable Studio Access to API Services (so coins and stats save)

## Editor (optional, recommended)

VS Code will suggest the **Rojo** and **Luau LSP** extensions. Luau LSP gives autocomplete and type checking for the Roblox API; it reads `default.project.json` to understand `require` paths.

## Website (`web/`)

Party, chat and voice site for players, deployed on Railway at **stormroyale.mparadiseplatrforms.com**.

- Node.js + Express + Socket.io, Postgres on Railway (in-memory when run locally)
- Email sign-in links (Resend); kids (under 13, parent-approved), teens and adults are kept apart everywhere
- Parties of 4 with party chat + party voice; open lobby rooms when you're not in a party
- Voice: WebRTC between players; your browser turns your speech into text for the AI safety check
- Moderation: Claude Haiku 4.5 checks every chat message, name and voice transcript; strikes, mutes, reports, admin page at `/admin`
- Game link: players link Roblox by putting a code in their Roblox profile About; the game uses a secret API key (`x-api-key`) to show website parties + filtered party chat in the lobby and to send match stats

Run locally: `cd web && npm install && DEV_SHOW_LINK=1 npm start` → http://localhost:3000 (sign-in links print in the terminal). Tests: `npm test`.

| Railway variable | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres (set automatically from the Postgres service) |
| `JWT_SECRET` | signs session cookies |
| `GAME_API_KEY` | the game server's key (also goes in Studio: ServerStorage → StringValue `StormRoyaleApiKey`) |
| `ANTHROPIC_API_KEY` | Claude moderation. Chat and voice stay off on the live site until this is set |
| `RESEND_API_KEY`, `EMAIL_FROM` | sign-in emails, e.g. `Storm Royale <no-reply@mparadiseplatrforms.com>` |
| `ADMIN_EMAILS` | comma-separated emails that can open `/admin` |
| `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` | optional relay for players whose network blocks direct voice |
| `PUBLIC_URL` | the site's address, used in email links |
| `KIDS_ENABLED` | `1` allows under-13 sign-ups (keep off until parent verification is connected) |
| `KWS_ENABLED`, `KWS_CLIENT_ID`, `KWS_CLIENT_SECRET` | Phase 2: Epic Kids Web Services parent verification |

### Kids accounts (under 13)
- Sign up with a parent's email; the account is locked until the parent approves it on **/parent**
- No open lobbies: kids only party with friends that **both** kids and **both** parents approved; never with teens or adults
- Chat and voice are off until a **verified** parent turns them on (verification = Phase 2, Epic KWS); kids without chat don't receive chat either
- Parents can remove friends, switch chat/voice off, and delete the account at any time; unapproved accounts are deleted after 7 days

### Game setup for the website link
1. Studio → Game Settings → Security → **Allow HTTP Requests** on
2. ServerStorage → add a **StringValue** named `StormRoyaleApiKey`, paste the `GAME_API_KEY` as its Value (never commit it)
