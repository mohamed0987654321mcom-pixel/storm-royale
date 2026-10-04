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
