-- Cosmetics: outfits (body colors) and gliders

local Core = require(script.Parent.Core)
local C = Core.C
local P, weld = Core.P, Core.weld

local Cosmetics = {}

-- returns the cosmetic definition and its kind ("Outfit" or "Glider")
function Cosmetics.find(id: string)
	for _, od in C.Outfits do
		if od.Id == id then
			return od, "Outfit"
		end
	end
	for _, g in C.Gliders do
		if g.Id == id then
			return g, "Glider"
		end
	end
	return nil, nil
end

function Cosmetics.applyOutfit(char: Model, id: string)
	local def = Cosmetics.find(id)
	if not def or not def.Colors then
		return
	end
	for _, d in char:GetChildren() do
		if d:IsA("Shirt") or d:IsA("Pants") or d:IsA("ShirtGraphic") or d:IsA("BodyColors") then
			d:Destroy()
		end
	end
	local cols = def.Colors -- head, torso, arms, legs
	for _, p in char:GetChildren() do
		if p:IsA("BasePart") then
			local n = p.Name
			if n == "Head" then
				p.Color = cols[1]
			elseif string.find(n, "Torso") then
				p.Color = cols[2]
			elseif string.find(n, "Arm") or string.find(n, "Hand") then
				p.Color = cols[3]
			elseif string.find(n, "Leg") or string.find(n, "Foot") then
				p.Color = cols[4]
			end
		end
	end
end

function Cosmetics.attachGlider(char: Model, gid: string?)
	if char:FindFirstChild("Glider") then
		return
	end
	local torso = char:FindFirstChild("UpperTorso") or char:FindFirstChild("Torso")
	if not torso or not torso:IsA("BasePart") then
		return
	end
	local def = C.Gliders[1]
	for _, g in C.Gliders do
		if g.Id == gid then
			def = g
		end
	end
	local m = Instance.new("Model")
	m.Name = "Glider"
	local wing = P(m, Vector3.new(14, 0.4, 5), CFrame.new(), def.Color, Enum.Material.Fabric, false)
	local trim = P(m, Vector3.new(14.2, 0.5, 0.8), CFrame.new(), def.Trim, Enum.Material.Neon, false)
	weld(wing, trim, CFrame.new(0, 0, -2.4))
	for _, x in { -2.5, 2.5 } do
		local s = P(m, Vector3.new(0.25, 5.5, 0.25), CFrame.new(), Color3.fromRGB(40, 40, 40), Enum.Material.Metal, false)
		weld(wing, s, CFrame.new(x, -2.7, 0.5))
	end
	for _, d in m:GetDescendants() do
		if d:IsA("BasePart") then
			d.CanCollide = false
			d.CanQuery = false
			d.Massless = true
		end
	end
	weld(torso, wing, CFrame.new(0, 6.5, 0) * CFrame.Angles(math.rad(-8), 0, 0))
	m.Parent = char
end

function Cosmetics.removeGlider(char: Model)
	local g = char:FindFirstChild("Glider")
	if g then
		g:Destroy()
	end
end

return Cosmetics
