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
- Moderation: one strict, all-ages standard for every player (see below); Claude Haiku 4.5 checks every chat message, name and voice transcript; admin page at `/admin`
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

### Strict moderation (a place for everyone)
- Same rules for kids, teens and adults: no swearing (even disguised), no put-downs, nothing sexual, no dating talk, no personal info (age, location, school, photos), no other apps or "dm me", no scams or spam, no dodging the filter
- A fast local filter catches links, emails, phone numbers and other-app names (also when written with look-alike or invisible characters); Claude checks everything else. If Claude is unsure, the message is just hidden (no penalty). If Claude can't be reached, nothing is shown
- Strike ladder (`web/lib/penalties.js`): 3 warnings in an hour = 1 strike; serious = 1 strike; severe = 2 strikes. Strikes mute for 15 min → 1 h → 24 h → 3 days, then a 7-day ban. Grooming or sexual content = instant ban until reviewed. Admins can lift any of it
- 3 different confirmed players reporting someone within 24 h mutes them for an hour while a moderator looks
- The same message 3 times in a minute is blocked; voice always needs the speech safety check (no check = listen only)
- Players do **not** do an age check. Only **parents** get verified (Phase 2, Epic KWS), so a fake parent can't unlock typing or voice for a kid

### "Skip email for now"
- New players can press **SKIP EMAIL FOR NOW** when signing up: the account is made and signed in at once, and a confirm link is emailed (works for 7 days, and can be sent again or sent to a corrected email)
- Until the email is confirmed: play, parties and quick chat work; **typing and voice stay locked** (so throwaway accounts can't be used to harass people or dodge bans)
- The email only counts once confirmed: it's stored as "pending", so skipping with someone else's email can't take it from them, and an unconfirmed email never gives admin access
- Limited to 5 skipped sign-ups per network per hour

### Kids accounts (under 13)
- Sign up with a parent's email; the account is locked until the parent approves it on **/parent**
- No open lobbies: kids only party with friends that **both** kids and **both** parents approved; never with teens or adults
- **Quick chat** (preset game phrases) works once a parent approves, with no verification needed, and parents can switch it off
- Typing and voice are off until a **verified** parent turns them on (verification = Phase 2, Epic KWS); kids only receive the kinds of chat they are allowed
- Parents can remove friends, switch chat/voice off, and delete the account at any time; unapproved accounts are deleted after 7 days

### Game setup for the website link
1. Studio → Game Settings → Security → **Allow HTTP Requests** on
2. ServerStorage → add a **StringValue** named `StormRoyaleApiKey`, paste the `GAME_API_KEY` as its Value (never commit it)
