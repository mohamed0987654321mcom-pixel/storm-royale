-- World: island terrain, named locations (POIs), houses, trees, rocks, cars, lobby pads

local Core = require(script.Parent.Core)
local C = Core.C
local P, groundY = Core.P, Core.groundY

local World = {}
World.ChestSpots = {} :: { CFrame }
World.LootSpots = {} :: { Vector3 }

local function harvestable(obj: Instance, kind: string, hp: number)
	obj:SetAttribute("HP", hp)
	obj:SetAttribute("MaxHP", hp)
	obj:SetAttribute("Harvest", kind)
end

local function nearPOI(x: number, z: number, dist: number): boolean
	for _, poi in C.POIs do
		if (Vector2.new(x, z) - poi.Pos).Magnitude < dist then
			return true
		end
	end
	return false
end

function World.genTerrain()
	local T = workspace.Terrain
	T:Clear()
	T:FillBlock(CFrame.new(0, -10, 0), Vector3.new(3400, 20, 3400), Enum.Material.Water)
	T:FillCylinder(CFrame.new(0, -8, 0), 16, C.ISLAND_R + 50, Enum.Material.Sand)
	T:FillCylinder(CFrame.new(0, -6, 0), 16, C.ISLAND_R, Enum.Material.Grass)
	T:FillBall(Vector3.new(0, -70, -480), 95, Enum.Material.Grass) -- Hilltop Heights
	for _ = 1, 16 do
		local a = math.random() * math.pi * 2
		local r = math.random(140, C.ISLAND_R - 110)
		local x, z = math.cos(a) * r, math.sin(a) * r
		if not nearPOI(x, z, 150) then
			T:FillBall(Vector3.new(x, -45, z), math.random(60, 90), Enum.Material.Grass)
		end
	end
	local W = C.WARMUP_CENTER
	T:FillCylinder(CFrame.new(W.X, -8, W.Z), 16, 175, Enum.Material.Sand)
	T:FillCylinder(CFrame.new(W.X, -6, W.Z), 16, 150, Enum.Material.Grass)
end

local function addTree(parent: Instance, x: number, z: number)
	local gy = groundY(x, z)
	local m = Instance.new("Model")
	m.Name = "Tree"
	local h = math.random(12, 18)
	P(m, Vector3.new(2.5, h, 2.5), CFrame.new(x, gy + h / 2, z), Color3.fromRGB(105, 70, 40), Enum.Material.Wood)
	local leaf = P(m, Vector3.one * math.random(11, 15), CFrame.new(x, gy + h + 3, z), Color3.fromRGB(60, 160 + math.random(0, 40), 60), Enum.Material.Grass, true)
	leaf.Shape = Enum.PartType.Ball
	harvestable(m, "Wood", 200)
	m.Parent = parent
end

local function addRock(parent: Instance, x: number, z: number)
	local s = math.random(6, 12)
	local cf = CFrame.new(x, groundY(x, z) + s * 0.2, z) * CFrame.Angles(math.random() * 0.4, math.random() * 6, math.random() * 0.4)
	local p = P(parent, Vector3.new(s, s * 0.7, s * 1.1), cf, Color3.fromRGB(120, 120, 125), Enum.Material.Slate)
	p.Name = "Rock"
	harvestable(p, "Brick", 250)
end

local function addCar(parent: Instance, x: number, z: number)
	local gy = groundY(x, z)
	local cf = CFrame.new(x, gy, z) * CFrame.Angles(0, math.random() * 6.28, 0)
	local m = Instance.new("Model")
	m.Name = "Car"
	local col = Color3.fromHSV(math.random(), 0.5, 0.75)
	P(m, Vector3.new(6, 2.6, 12), cf * CFrame.new(0, 2.2, 0), col, Enum.Material.Metal)
	P(m, Vector3.new(5.6, 2.4, 6), cf * CFrame.new(0, 4.6, 0.6), col, Enum.Material.Metal)
	P(m, Vector3.new(5.7, 1.6, 0.3), cf * CFrame.new(0, 4.6, -2.45), Color3.fromRGB(40, 60, 80), Enum.Material.Glass)
	for _, o in { Vector3.new(-3, 1, -3.8), Vector3.new(3, 1, -3.8), Vector3.new(-3, 1, 3.8), Vector3.new(3, 1, 3.8) } do
		local w = P(m, Vector3.new(1, 2.2, 2.2), cf * CFrame.new(o), Color3.fromRGB(25, 25, 25), Enum.Material.SmoothPlastic)
		w.Shape = Enum.PartType.Cylinder
	end
	harvestable(m, "Metal", 300)
	m.Parent = parent
end

local function addContainer(parent: Instance, cf: CFrame)
	local p = P(parent, Vector3.new(10, 10, 24), cf, Color3.fromHSV(math.random(), 0.6, 0.6), Enum.Material.CorrodedMetal)
	p.Name = "Container"
	harvestable(p, "Metal", 400)
	return p
end

local function buildHouse(poi, pos: Vector2, facing: Vector2)
	local floors = math.random(math.max(1, poi.Floors - 1), poi.Floors)
	local gy = groundY(pos.X, pos.Y)
	for _, o in { Vector2.new(14, 14), Vector2.new(-14, 14), Vector2.new(14, -14), Vector2.new(-14, -14) } do
		gy = math.max(gy, groundY(pos.X + o.X, pos.Y + o.Y))
	end
	local base = Vector3.new(pos.X, gy, pos.Y)
	local cf = CFrame.lookAt(base, Vector3.new(facing.X, gy, facing.Y))
	local m = Instance.new("Model")
	m.Name = "House"
	local H = 14
	local wallMat = poi.Style == "City" and Enum.Material.Concrete or Enum.Material.WoodPlanks
	local harvestKind = poi.Style == "City" and "Brick" or "Wood"
	P(m, Vector3.new(31, 30, 31), cf * CFrame.new(0, -15, 0), Color3.fromRGB(125, 125, 125), Enum.Material.Concrete)
	local function wall(size: Vector3, off: CFrame, color: Color3?, mat: Enum.Material?)
		local p = P(m, size, cf * off, color or poi.Wall, mat or wallMat)
		harvestable(p, harvestKind, 250)
		return p
	end
	for k = 0, floors - 1 do
		local b = k * H
		wall(Vector3.new(30, H, 1), CFrame.new(0, b + H / 2, 14.5))
		wall(Vector3.new(1, H, 28), CFrame.new(-14.5, b + H / 2, 0))
		wall(Vector3.new(1, H, 28), CFrame.new(14.5, b + H / 2, 0))
		wall(Vector3.new(11, H, 1), CFrame.new(-9.5, b + H / 2, -14.5))
		wall(Vector3.new(11, H, 1), CFrame.new(9.5, b + H / 2, -14.5))
		if k == 0 then
			wall(Vector3.new(8, H - 10, 1), CFrame.new(0, b + 10 + (H - 10) / 2, -14.5))
		else
			wall(Vector3.new(8, 5, 1), CFrame.new(0, b + 2.5, -14.5))
			wall(Vector3.new(8, 3, 1), CFrame.new(0, b + H - 1.5, -14.5))
			wall(Vector3.new(22, 1, 28), CFrame.new(-3, b - 0.5, 0), poi.Roof, Enum.Material.WoodPlanks)
			wall(Vector3.new(6, 1, 16), CFrame.new(11, b - 0.5, -6), poi.Roof, Enum.Material.WoodPlanks)
			local st = P(m, Vector3.new(6, H, 16), cf * CFrame.new(11, b - H / 2, 6), poi.Roof, Enum.Material.WoodPlanks, true, "WedgePart")
			harvestable(st, "Wood", 250)
		end
		table.insert(World.LootSpots, (cf * CFrame.new(-4, b, -4)).Position)
		if math.random() < 0.6 then
			table.insert(World.ChestSpots, cf * CFrame.new(-9, b + 1, 9))
		end
	end
	local top = floors * H
	if floors == 1 then
		wall(Vector3.new(30, 1, 30), CFrame.new(0, top + 0.5, 0), poi.Roof)
		local w1 = P(m, Vector3.new(32, 8, 16), cf * CFrame.new(0, top + 5, -8), poi.Roof, Enum.Material.Slate, true, "WedgePart")
		local w2 = P(m, Vector3.new(32, 8, 16), cf * CFrame.new(0, top + 5, 8) * CFrame.Angles(0, math.pi, 0), poi.Roof, Enum.Material.Slate, true, "WedgePart")
		harvestable(w1, "Wood", 250)
		harvestable(w2, "Wood", 250)
	else
		wall(Vector3.new(31, 1, 31), CFrame.new(0, top + 0.5, 0), poi.Roof, Enum.Material.Concrete)
	end
	m.Parent = Core.MapF
end

-- (re)builds everything destructible on the island and records chest/loot spots
function World.buildMap()
	local MapF = Core.MapF
	MapF:ClearAllChildren()
	table.clear(World.ChestSpots)
	table.clear(World.LootSpots)
	for _, poi in C.POIs do
		local c = poi.Pos
		local n = poi.Houses
		for i = 1, n do
			local a = (i / n) * math.pi * 2 + math.random() * 0.3
			local r = (poi.Style == "City") and 62 or math.random(55, 75)
			buildHouse(poi, c + Vector2.new(math.cos(a), math.sin(a)) * r, c)
		end
		if poi.Style == "City" then
			local gy = groundY(c.X, c.Y)
			local t = P(MapF, Vector3.new(6, 50, 6), CFrame.new(c.X, gy + 25, c.Y), Color3.fromRGB(0, 255, 230), Enum.Material.Neon)
			t.Name = "NeonSpire"
			table.insert(World.ChestSpots, CFrame.new(c.X + 6, gy + 1, c.Y))
		elseif poi.Style == "Crates" or poi.Style == "Junk" then
			for _ = 1, (poi.Style == "Crates") and 12 or 5 do
				local x, z = c.X + math.random(-45, 45), c.Y + math.random(-45, 45)
				local gy = groundY(x, z)
				local cf = CFrame.new(x, gy + 5, z) * CFrame.Angles(0, math.random(0, 3) * math.pi / 2, 0)
				addContainer(MapF, cf)
				if math.random() < 0.4 then
					addContainer(MapF, cf * CFrame.new(0, 10, 0))
					table.insert(World.ChestSpots, cf * CFrame.new(0, 16, 0))
				else
					table.insert(World.LootSpots, (cf * CFrame.new(0, 5, 0)).Position)
				end
			end
		end
		if poi.Style == "Junk" then
			for _ = 1, 10 do
				addCar(MapF, c.X + math.random(-60, 60), c.Y + math.random(-60, 60))
			end
		end
		for _ = 1, 5 do
			local x, z = c.X + math.random(-80, 80), c.Y + math.random(-80, 80)
			table.insert(World.LootSpots, Vector3.new(x, groundY(x, z), z))
		end
	end
	for _ = 1, 150 do
		local a, r = math.random() * math.pi * 2, math.sqrt(math.random()) * (C.ISLAND_R - 30)
		local x, z = math.cos(a) * r, math.sin(a) * r
		if not nearPOI(x, z, 95) then
			addTree(MapF, x, z)
		end
	end
	for _ = 1, 45 do
		local a, r = math.random() * math.pi * 2, math.sqrt(math.random()) * (C.ISLAND_R - 40)
		local x, z = math.cos(a) * r, math.sin(a) * r
		if not nearPOI(x, z, 90) then
			addRock(MapF, x, z)
		end
	end
	for _ = 1, 12 do
		local a, r = math.random() * math.pi * 2, math.random(100, C.ISLAND_R - 60)
		addCar(MapF, math.cos(a) * r, math.sin(a) * r)
	end
	-- warm-up island props
	local W = C.WARMUP_CENTER
	for _ = 1, 14 do
		local a, r = math.random() * math.pi * 2, math.random(40, 135)
		addTree(MapF, W.X + math.cos(a) * r, W.Z + math.sin(a) * r)
	end
	for _ = 1, 6 do
		local a, r = math.random() * math.pi * 2, math.random(30, 120)
		addRock(MapF, W.X + math.cos(a) * r, W.Z + math.sin(a) * r)
	end
end

-- lobby stage pad for a player slot; returns where the character stands
function World.makePad(slot: number): Vector3
	local MenuF = Core.MenuF
	local pos = C.MENU_POS + Vector3.new(slot * 70, 0, 0)
	local pad = P(MenuF, Vector3.new(1.5, 16, 16), CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90)), Color3.fromRGB(30, 40, 80), Enum.Material.SmoothPlastic)
	pad.Shape = Enum.PartType.Cylinder
	local ring = P(MenuF, Vector3.new(1.6, 17, 17), CFrame.new(pos - Vector3.new(0, 0.1, 0)) * CFrame.Angles(0, 0, math.rad(90)), Color3.fromRGB(0, 200, 255), Enum.Material.Neon)
	ring.Shape = Enum.PartType.Cylinder
	return pos + Vector3.new(0, 0.75, 0)
end

return World
