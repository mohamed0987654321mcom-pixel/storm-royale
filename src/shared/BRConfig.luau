-- BRConfig (ModuleScript) — Rojo syncs this to ReplicatedStorage.Shared
-- Shared settings for Storm Royale (server + client)

local C = {}

C.GRID = 12
C.ISLAND_R = 720
C.WARMUP_CENTER = Vector3.new(1250, 0, 0)
C.MENU_POS = Vector3.new(3000, 600, 3000)
C.TOTAL_PLAYERS = 16 -- real players + bots per match
C.MIN_READY = 1
C.COUNTDOWN = 20
C.BUS_HEIGHT = 420
C.BUS_TIME = 32
C.BUS_DOORS = 3
C.BUS_HALF = 1100
C.MAT_MAX = 999
C.BUILD_COST = 10
C.BUILD_RANGE = 40
C.STORM_START_R = 1050
C.SKYDIVE_SPEED = 85
C.GLIDE_SPEED = 24
C.GLIDE_AUTO = 110
C.SLOTS = 6

C.Rarities = {
	{ Name = "Common", Color = Color3.fromRGB(150, 150, 150), Mult = 1.00 },
	{ Name = "Uncommon", Color = Color3.fromRGB(80, 170, 50), Mult = 1.05 },
	{ Name = "Rare", Color = Color3.fromRGB(50, 150, 240), Mult = 1.10 },
	{ Name = "Epic", Color = Color3.fromRGB(170, 70, 230), Mult = 1.16 },
	{ Name = "Legendary", Color = Color3.fromRGB(235, 140, 40), Mult = 1.22 },
}
C.RarityWeights = { 35, 30, 20, 10, 5 }
C.ChestRarityWeights = { 0, 35, 35, 20, 10 }

C.Weapons = {
	AR = { Name = "Assault Rifle", Damage = 30, Head = 1.5, Rate = 5.5, Mag = 30, Reload = 2.3, Ammo = "Medium", Spread = 2.2, Ads = 0.8, Range = 700, Auto = true, Len = 3.2, Color = Color3.fromRGB(60, 60, 70) },
	Shotgun = { Name = "Pump Shotgun", Damage = 9, Pellets = 10, Head = 2, Rate = 0.75, Mag = 5, Reload = 3.6, Ammo = "Shells", Spread = 5.5, Ads = 4.5, Range = 70, Auto = false, Len = 3.6, Color = Color3.fromRGB(110, 70, 40) },
	SMG = { Name = "SMG", Damage = 16, Head = 1.5, Rate = 12, Mag = 30, Reload = 2, Ammo = "Light", Spread = 3.5, Ads = 2.5, Range = 300, Auto = true, Len = 2.2, Color = Color3.fromRGB(40, 40, 45) },
	Sniper = { Name = "Bolt Sniper", Damage = 105, Head = 2.5, Rate = 0.35, Mag = 1, Reload = 2.6, Ammo = "Heavy", Spread = 5, Ads = 0, Range = 2000, Auto = false, Len = 4.4, Scope = true, Color = Color3.fromRGB(50, 70, 50) },
	Pistol = { Name = "Pistol", Damage = 24, Head = 1.75, Rate = 6, Mag = 16, Reload = 1.5, Ammo = "Light", Spread = 2, Ads = 1, Range = 350, Auto = false, Len = 1.4, Color = Color3.fromRGB(70, 70, 70) },
}
C.WeaponWeights = { AR = 26, Shotgun = 22, SMG = 18, Pistol = 16, Sniper = 7 }

C.Pickaxe = { Name = "Harvesting Tool", Damage = 20, BuildDamage = 50, Rate = 1.8, Range = 12 }

C.Consumables = {
	Bandage = { Name = "Bandages", Heal = 15, Cap = 75, Time = 3.5, Stack = 15, Color = Color3.fromRGB(240, 240, 240) },
	Medkit = { Name = "Med Kit", Heal = 100, Cap = 100, Time = 7, Stack = 3, Color = Color3.fromRGB(230, 60, 60) },
	SmallShield = { Name = "Small Shield", Shield = 25, Cap = 50, Time = 2, Stack = 6, Color = Color3.fromRGB(90, 190, 255) },
	ShieldPotion = { Name = "Shield Potion", Shield = 50, Cap = 100, Time = 4, Stack = 3, Color = Color3.fromRGB(40, 110, 255) },
}
C.ConsumableWeights = { Bandage = 34, SmallShield = 30, ShieldPotion = 20, Medkit = 16 }

C.AmmoTypes = { "Light", "Medium", "Heavy", "Shells" }
C.AmmoPickup = { Light = 36, Medium = 30, Heavy = 6, Shells = 10 }

C.Materials = {
	Wood = { HP = 150, Time = 2.5, Color = Color3.fromRGB(170, 115, 65), Mat = Enum.Material.WoodPlanks },
	Brick = { HP = 300, Time = 4, Color = Color3.fromRGB(160, 85, 70), Mat = Enum.Material.Brick },
	Metal = { HP = 500, Time = 6, Color = Color3.fromRGB(150, 155, 165), Mat = Enum.Material.DiamondPlate },
}
C.MatOrder = { "Wood", "Brick", "Metal" }
C.PieceOrder = { "Wall", "Floor", "Ramp", "Roof" }
C.Dirs = { Vector3.new(1, 0, 0), Vector3.new(0, 0, 1), Vector3.new(-1, 0, 0), Vector3.new(0, 0, -1) }

C.POIs = {
	{ Name = "Neon Plaza", Pos = Vector2.new(0, 0), Style = "City", Houses = 5, Floors = 3, Wall = Color3.fromRGB(70, 80, 110), Roof = Color3.fromRGB(40, 40, 60) },
	{ Name = "Maple Grove", Pos = Vector2.new(-390, -250), Style = "Suburb", Houses = 6, Floors = 1, Wall = Color3.fromRGB(230, 220, 190), Roof = Color3.fromRGB(150, 60, 50) },
	{ Name = "Crate City", Pos = Vector2.new(370, -300), Style = "Crates", Houses = 2, Floors = 2, Wall = Color3.fromRGB(120, 120, 130), Roof = Color3.fromRGB(70, 70, 80) },
	{ Name = "Rusty Yards", Pos = Vector2.new(420, 260), Style = "Junk", Houses = 3, Floors = 1, Wall = Color3.fromRGB(150, 110, 80), Roof = Color3.fromRGB(90, 60, 40) },
	{ Name = "Shady Shores", Pos = Vector2.new(-430, 290), Style = "Suburb", Houses = 5, Floors = 2, Wall = Color3.fromRGB(120, 200, 210), Roof = Color3.fromRGB(240, 240, 240) },
	{ Name = "Hilltop Heights", Pos = Vector2.new(0, -480), Style = "Suburb", Houses = 4, Floors = 2, Wall = Color3.fromRGB(200, 170, 120), Roof = Color3.fromRGB(70, 90, 60) },
	{ Name = "Frosty Fields", Pos = Vector2.new(30, 470), Style = "Suburb", Houses = 4, Floors = 1, Wall = Color3.fromRGB(235, 240, 250), Roof = Color3.fromRGB(80, 130, 200) },
}

-- Storm circles: wait (seconds), shrink (seconds), final radius, damage per second
C.Storm = {
	{ Wait = 60, Shrink = 45, Radius = 520, Dmg = 1 },
	{ Wait = 45, Shrink = 35, Radius = 300, Dmg = 1 },
	{ Wait = 35, Shrink = 30, Radius = 160, Dmg = 2 },
	{ Wait = 30, Shrink = 25, Radius = 80, Dmg = 5 },
	{ Wait = 20, Shrink = 25, Radius = 30, Dmg = 8 },
	{ Wait = 15, Shrink = 30, Radius = 0, Dmg = 10 },
}

-- Locker cosmetics (Default keeps the player's own Roblox avatar)
C.Outfits = {
	{ Id = "Default", Name = "Your Avatar", Price = 0, Rarity = 1 },
	{ Id = "Recruit", Name = "Recruit", Price = 0, Rarity = 1, Colors = { Color3.fromRGB(240, 200, 160), Color3.fromRGB(70, 110, 60), Color3.fromRGB(240, 200, 160), Color3.fromRGB(60, 60, 50) } },
	{ Id = "Midnight", Name = "Midnight Ops", Price = 300, Rarity = 3, Colors = { Color3.fromRGB(30, 30, 40), Color3.fromRGB(20, 20, 30), Color3.fromRGB(60, 40, 120), Color3.fromRGB(20, 20, 30) } },
	{ Id = "Toxic", Name = "Toxic Trooper", Price = 500, Rarity = 4, Colors = { Color3.fromRGB(120, 255, 60), Color3.fromRGB(40, 40, 40), Color3.fromRGB(120, 255, 60), Color3.fromRGB(40, 40, 40) } },
	{ Id = "Frost", Name = "Frost Knight", Price = 800, Rarity = 4, Colors = { Color3.fromRGB(200, 240, 255), Color3.fromRGB(90, 170, 240), Color3.fromRGB(200, 240, 255), Color3.fromRGB(40, 90, 180) } },
	{ Id = "Golden", Name = "Golden Legend", Price = 1200, Rarity = 5, Colors = { Color3.fromRGB(255, 210, 60), Color3.fromRGB(230, 170, 30), Color3.fromRGB(255, 210, 60), Color3.fromRGB(200, 140, 20) } },
}
C.Gliders = {
	{ Id = "Classic", Name = "Classic Glider", Price = 0, Rarity = 1, Color = Color3.fromRGB(60, 140, 255), Trim = Color3.fromRGB(255, 255, 255) },
	{ Id = "Sunset", Name = "Sunset Wing", Price = 200, Rarity = 3, Color = Color3.fromRGB(255, 120, 60), Trim = Color3.fromRGB(255, 220, 80) },
	{ Id = "Royal", Name = "Royal Wing", Price = 600, Rarity = 4, Color = Color3.fromRGB(150, 60, 230), Trim = Color3.fromRGB(255, 210, 60) },
}

C.Coins = { Kill = 25, Win = 100, Match = 10 }

-- Build piece geometry (shared so the client preview matches the server exactly)
-- returns key, { {CFrame, Size, isWedge}, ... }
function C.Piece(kind: string, cx: number, ly: number, cz: number, dir: number)
	local G = C.GRID
	local d = C.Dirs[dir] or C.Dirs[1]
	local baseY = ly * G
	if kind == "Wall" then
		if dir == 1 or dir == 3 then
			local ex = (dir == 1) and cx + 1 or cx
			return `W:X:{ex}:{ly}:{cz}`, { { CFrame.new(ex * G, baseY + G / 2, (cz + 0.5) * G), Vector3.new(1, G, G), false } }
		else
			local ez = (dir == 2) and cz + 1 or cz
			return `W:Z:{cx}:{ly}:{ez}`, { { CFrame.new((cx + 0.5) * G, baseY + G / 2, ez * G), Vector3.new(G, G, 1), false } }
		end
	elseif kind == "Floor" then
		return `F:{cx}:{ly}:{cz}`, { { CFrame.new((cx + 0.5) * G, baseY, (cz + 0.5) * G), Vector3.new(G, 1, G), false } }
	elseif kind == "Ramp" then
		local c = Vector3.new((cx + 0.5) * G, baseY + G / 2, (cz + 0.5) * G)
		return `R:{cx}:{ly}:{cz}`, { { CFrame.lookAt(c, c + d) * CFrame.Angles(math.rad(45), 0, 0), Vector3.new(G, 1, G * 1.414), false } }
	else -- Roof (A-frame)
		local c = Vector3.new((cx + 0.5) * G, baseY + G / 4, (cz + 0.5) * G)
		local cf = CFrame.lookAt(c, c + d)
		return `C:{cx}:{ly}:{cz}`, {
			{ cf * CFrame.new(0, 0, -G / 4), Vector3.new(G, G / 2, G / 2), true },
			{ cf * CFrame.Angles(0, math.pi, 0) * CFrame.new(0, 0, -G / 4), Vector3.new(G, G / 2, G / 2), true },
		}
	end
end

-- Storm circle at a given server time (state = ReplicatedStorage.BRState)
function C.StormAt(state: Instance, t: number): (Vector2, number)
	local t0 = state:GetAttribute("StormT0") or 0
	local t1 = state:GetAttribute("StormT1") or 0
	local c0 = state:GetAttribute("StormC0") or Vector2.zero
	local c1 = state:GetAttribute("StormC1") or Vector2.zero
	local r0 = state:GetAttribute("StormR0") or C.STORM_START_R
	local r1 = state:GetAttribute("StormR1") or C.STORM_START_R
	local a = 0
	if t1 > t0 then
		a = math.clamp((t - t0) / (t1 - t0), 0, 1)
	elseif t >= t1 and t1 > 0 then
		a = 1
	end
	return c0:Lerp(c1, a), r0 + (r1 - r0) * a
end

function C.ItemName(item): string
	if not item then
		return ""
	end
	if item.Id == "Pickaxe" then
		return C.Pickaxe.Name
	end
	local w = C.Weapons[item.Id]
	if w then
		return w.Name
	end
	local c = C.Consumables[item.Id]
	if c then
		return c.Name
	end
	return item.Id
end

function C.Weighted(weights)
	local total = 0
	for _, w in weights do
		total += w
	end
	local r = math.random() * total
	for k, w in weights do
		r -= w
		if r <= 0 then
			return k
		end
	end
	return next(weights)
end

return C
