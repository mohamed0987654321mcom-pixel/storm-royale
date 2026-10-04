-- Loot: floor loot, chests, pickups and dropping everything when eliminated

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local World = require(script.Parent.World)
local C = Core.C
local P = Core.P

local Loot = {}

function Loot.randomWeapon(fromChest: boolean)
	local id = C.Weighted(C.WeaponWeights)
	local r = C.Weighted(fromChest and C.ChestRarityWeights or C.RarityWeights)
	return { Id = id, R = r, Mag = C.Weapons[id].Mag }
end

function Loot.randomConsumable()
	local id = C.Weighted(C.ConsumableWeights)
	local n = (id == "Bandage") and 5 or (id == "SmallShield") and 3 or 1
	return { Id = id, N = n }
end

-- picks up a loot part for a player or bot (swaps with the held slot when full)
function Loot.tryPickup(o, loot: BasePart)
	if not loot.Parent then
		return
	end
	local id = loot:GetAttribute("Item") :: string
	local n = (loot:GetAttribute("N") :: number?) or 1
	if string.sub(id, 1, 5) == "Ammo_" then
		Inventory.giveAmmo(o, string.sub(id, 6), n)
		loot:Destroy()
	elseif string.sub(id, 1, 4) == "Mat_" then
		Inventory.giveMat(o, string.sub(id, 5), n)
		loot:Destroy()
	else
		local item = { Id = id, R = loot:GetAttribute("R"), Mag = loot:GetAttribute("Mag"), N = loot:GetAttribute("N") }
		if Inventory.addItem(o, item) then
			loot:Destroy()
		else
			if item.N then
				loot:SetAttribute("N", item.N)
			end
			local eq = o.Inv.Eq
			if eq >= 2 then
				local old = o.Inv.Slots[eq]
				o.Inv.Slots[eq] = item
				local pos = loot.Position
				loot:Destroy()
				if old then
					Loot.spawnLoot(old, pos)
				end
			else
				Core.toast(o.Player, "Inventory full! Select a slot to swap.")
			end
		end
	end
	Inventory.sync(o)
	Inventory.updateHeld(o)
end

function Loot.spawnLoot(item, pos: Vector3): BasePart
	local id: string = item.Id
	local color, size, label
	local w = C.Weapons[id]
	local cd = C.Consumables[id]
	if string.sub(id, 1, 5) == "Ammo_" then
		color, size, label = Color3.fromRGB(150, 140, 90), Vector3.new(1.4, 1, 1.4), string.sub(id, 6) .. " Ammo"
	elseif string.sub(id, 1, 4) == "Mat_" then
		local mat = string.sub(id, 5)
		color, size, label = C.Materials[mat].Color, Vector3.new(2, 1, 2), mat
	elseif w then
		color, size, label = C.Rarities[item.R or 1].Color, Vector3.new(0.5, 0.7, w.Len), C.Rarities[item.R or 1].Name .. " " .. w.Name
	else
		color, size, label = cd and cd.Color or Color3.new(1, 1, 1), Vector3.new(1, 1.2, 1), cd and cd.Name or id
	end
	local p = P(Core.LootF, size, CFrame.new(pos + Vector3.new(0, 1.3, 0)) * CFrame.Angles(0, math.random() * 6.28, 0), color, Enum.Material.Neon)
	p.Name = "Loot"
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p:SetAttribute("Item", id)
	if item.R then
		p:SetAttribute("R", item.R)
	end
	if item.Mag then
		p:SetAttribute("Mag", item.Mag)
	end
	if item.N then
		p:SetAttribute("N", item.N)
	end
	local light = Instance.new("PointLight")
	light.Color = color
	light.Range = 9
	light.Brightness = 1.5
	light.Parent = p
	local pr = Instance.new("ProximityPrompt")
	pr.ActionText = "Pick up"
	pr.ObjectText = label .. ((item.N and item.N > 1) and (" x" .. item.N) or "")
	pr.HoldDuration = 0
	pr.MaxActivationDistance = 9
	pr.RequiresLineOfSight = false
	pr.Parent = p
	pr.Triggered:Connect(function(plr)
		local o = Core.Owners[plr]
		if o and Core.aliveHum(o) then
			Loot.tryPickup(o, p)
		end
	end)
	return p
end

function Loot.openChest(chest: Model)
	if not chest.Parent then
		return
	end
	local pos = chest:GetPivot().Position
	chest:Destroy()
	local wpn = Loot.randomWeapon(true)
	local ammo = C.Weapons[wpn.Id].Ammo
	Loot.spawnLoot(wpn, pos + Vector3.new(2, 0, 0))
	Loot.spawnLoot({ Id = "Ammo_" .. ammo, N = C.AmmoPickup[ammo] }, pos + Vector3.new(-2, 0, 1))
	Loot.spawnLoot(Loot.randomConsumable(), pos + Vector3.new(0, 0, 2))
	Loot.spawnLoot({ Id = "Mat_Wood", N = 30 }, pos + Vector3.new(0, 0, -2))
end

local function spawnChest(cf: CFrame)
	local m = Instance.new("Model")
	m.Name = "Chest"
	local base = P(m, Vector3.new(3.2, 2, 2.2), cf, Color3.fromRGB(200, 140, 30), Enum.Material.Metal)
	P(m, Vector3.new(3.3, 0.8, 2.3), cf * CFrame.new(0, 1.4, 0), Color3.fromRGB(255, 210, 60), Enum.Material.Neon)
	m.PrimaryPart = base
	local sp = Instance.new("Sparkles")
	sp.SparkleColor = Color3.fromRGB(255, 220, 90)
	sp.Parent = base
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 200, 80)
	light.Range = 12
	light.Parent = base
	local pr = Instance.new("ProximityPrompt")
	pr.ActionText = "Search"
	pr.ObjectText = "Chest"
	pr.HoldDuration = 0.6
	pr.MaxActivationDistance = 10
	pr.RequiresLineOfSight = false
	pr.Parent = base
	pr.Triggered:Connect(function(plr)
		local o = Core.Owners[plr]
		if o and Core.aliveHum(o) then
			Loot.openChest(m)
		end
	end)
	m.Parent = Core.LootF
	return m
end

function Loot.resetLoot()
	Core.LootF:ClearAllChildren()
	for _, cf in World.ChestSpots do
		if math.random() < 0.75 then
			spawnChest(cf)
		end
	end
	for _, pos in World.LootSpots do
		if math.random() < 0.7 then
			local item = (math.random() < 0.6) and Loot.randomWeapon(false) or Loot.randomConsumable()
			Loot.spawnLoot(item, pos)
			local w = C.Weapons[item.Id]
			if w then
				Loot.spawnLoot({ Id = "Ammo_" .. w.Ammo, N = C.AmmoPickup[w.Ammo] }, pos + Vector3.new(2, 0, 1))
			end
		end
	end
end

function Loot.dropAll(o, pos: Vector3)
	local inv = o.Inv
	local function spot()
		return pos + Vector3.new(math.random(-5, 5), 0, math.random(-5, 5))
	end
	for i = 2, C.SLOTS do
		local it = inv.Slots[i]
		if it then
			Loot.spawnLoot(it, spot())
		end
	end
	for typ, n in inv.Ammo do
		if n > 0 then
			Loot.spawnLoot({ Id = "Ammo_" .. typ, N = n }, spot())
		end
	end
	for mat, n in inv.Mats do
		if n > 0 then
			Loot.spawnLoot({ Id = "Mat_" .. mat, N = n }, spot())
		end
	end
end

return Loot
