-- Building: walls, floors, ramps and roofs on the shared grid (see BRConfig.Piece)

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local C = Core.C

local Building = {}
Building.Builds = {} :: { [string]: Model } -- grid key -> piece

function Building.clear()
	Core.BuildF:ClearAllChildren()
	table.clear(Building.Builds)
end

function Building.placePiece(o, kind: string, cx: number, ly: number, cz: number, dir: number)
	local inv = o.Inv
	local mode = Core.getMode(o)
	local char = Core.getChar(o)
	if (mode ~= "Match" and mode ~= "Warmup") or not char or not Core.aliveHum(o) or char:GetAttribute("Drop") then
		return
	end
	if not table.find(C.PieceOrder, kind) then
		return
	end
	cx, ly, cz = math.floor(cx), math.floor(ly), math.floor(cz)
	dir = math.clamp(math.floor(dir), 1, 4)
	local warm = mode == "Warmup"
	local matName = C.MatOrder[inv.MatSel]
	if not warm and inv.Mats[matName] < C.BUILD_COST then
		for i, mn in C.MatOrder do
			if inv.Mats[mn] >= C.BUILD_COST then
				inv.MatSel = i
				matName = mn
				break
			end
		end
		if inv.Mats[matName] < C.BUILD_COST then
			Core.toast(o.Player, "Not enough materials! Harvest with your pickaxe.")
			return
		end
	end
	local key, parts = C.Piece(kind, cx, ly, cz, dir)
	local existing = Building.Builds[key]
	if existing and existing.Parent then
		return
	end
	local hrp = char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp or (parts[1][1].Position - hrp.Position).Magnitude > C.BUILD_RANGE then
		return
	end
	if not warm then
		inv.Mats[matName] -= C.BUILD_COST
	end
	local md = C.Materials[matName]
	local m = Instance.new("Model")
	m.Name = "Build_" .. kind
	for _, spec in parts do
		local p = Core.P(m, spec[2], spec[1], md.Color, md.Mat, true, spec[3] and "WedgePart" or "Part")
		p.Transparency = 0.5
	end
	-- pieces start weak and "grow" to full health, like Fortnite
	m:SetAttribute("HP", md.HP * 0.1)
	m:SetAttribute("MaxHP", md.HP)
	m:SetAttribute("Key", key)
	m.Parent = Core.BuildF
	Building.Builds[key] = m
	task.spawn(function()
		local steps = 10
		for i = 1, steps do
			task.wait(md.Time / steps)
			if not m.Parent then
				return
			end
			m:SetAttribute("HP", math.min(md.HP, (m:GetAttribute("HP") or 0) + md.HP * 0.09))
			for _, p in m:GetChildren() do
				if p:IsA("BasePart") then
					p.Transparency = 0.5 * (1 - i / steps)
				end
			end
		end
	end)
	Inventory.sync(o)
end

return Building
