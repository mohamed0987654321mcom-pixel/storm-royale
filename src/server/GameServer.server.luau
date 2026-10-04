-- GameServer (Script) — boots Storm Royale. The game logic lives in ./Modules:
--   Core          services, remotes, shared state, saved data
--   Inventory     slots, ammo, materials, held item
--   World         island, POIs, houses, trees, lobby pads
--   Loot          floor loot, chests, pickups
--   Building      walls / floors / ramps / roofs
--   Combat        guns, pickaxe, damage, reload, healing
--   Cosmetics     outfits and gliders
--   Eliminations  kill credit, feed, placement
--   Bots          AI players
--   SkyBus        the bus and jumping out
--   Storm         storm circles and storm damage
--   PlayerFlow    joining, lobby, warm-up island
--   Match         countdown → bus → storm → winner
--   Remotes       client requests
--   WebLink       website parties, party chat, stats (needs HTTP + API key, see the file)

local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local StarterPlayer = game:GetService("StarterPlayer")

Players.CharacterAutoLoads = false

local Modules = script.Parent:WaitForChild("Modules")
local World = require(Modules.World)
local Loot = require(Modules.Loot)
local Bots = require(Modules.Bots)
local PlayerFlow = require(Modules.PlayerFlow)
local Match = require(Modules.Match)
local Remotes = require(Modules.Remotes)
local Storm = require(Modules.Storm)
local WebLink = require(Modules.WebLink)

-- an empty "Health" script turns off Roblox's default health regen
do
	local scs = StarterPlayer:WaitForChild("StarterCharacterScripts")
	if not scs:FindFirstChild("Health") then
		local h = Instance.new("Script")
		h.Name = "Health"
		h.Parent = scs
	end
end

-- clear the default Baseplate template so it doesn't cover the island
for _, d in workspace:GetChildren() do
	if d.Name == "Baseplate" or d:IsA("SpawnLocation") then
		d:Destroy()
	end
end

-- bright, saturated look
Lighting.ClockTime = 14.5
Lighting.Brightness = 3
Lighting.OutdoorAmbient = Color3.fromRGB(140, 140, 155)
Lighting.GlobalShadows = true
do
	local atm = Instance.new("Atmosphere")
	atm.Density = 0.22
	atm.Haze = 0.8
	atm.Color = Color3.fromRGB(200, 225, 255)
	atm.Decay = Color3.fromRGB(110, 150, 210)
	atm.Parent = Lighting
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Saturation = 0.25
	cc.Contrast = 0.06
	cc.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.4
	bloom.Threshold = 1.6
	bloom.Parent = Lighting
end

Remotes.connect()
World.genTerrain()
World.buildMap()
Loot.resetLoot()
Storm.reset()
PlayerFlow.start()
WebLink.start()
Bots.startLoop()
Match.startLoop()
