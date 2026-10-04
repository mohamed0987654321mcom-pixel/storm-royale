-- Effects: bullet tracers, muzzle flash, floating damage numbers, hit markers

local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

local Core = require(script.Parent.Core)
local Hud = require(script.Parent.Hud)
local new, text = Core.new, Core.text
local WHITE, FONT_H = Core.WHITE, Core.FONT_H

local Effects = {}

local FxLocal = new("Folder", { Name = "BR_LocalFX" }, workspace)
table.insert(Core.ignore, FxLocal)

function Effects.tracer(from: Vector3, to: Vector3)
	local len = (to - from).Magnitude
	if len < 0.5 then
		return
	end
	local p = new("Part", {
		Anchored = true,
		CanCollide = false,
		CanQuery = false,
		CanTouch = false,
		CastShadow = false,
		Material = Enum.Material.Neon,
		Color = Color3.fromRGB(255, 230, 150),
		Size = Vector3.new(0.12, 0.12, len),
		CFrame = CFrame.lookAt(from, to) * CFrame.new(0, 0, -len / 2),
		Transparency = 0.2,
	}, FxLocal)
	TweenService:Create(p, TweenInfo.new(0.12), { Transparency = 1 }):Play()
	Debris:AddItem(p, 0.15)
end

function Effects.muzzleFlash(pos: Vector3)
	local p = new("Part", { Anchored = true, CanCollide = false, CanQuery = false, CastShadow = false, Shape = Enum.PartType.Ball, Material = Enum.Material.Neon, Color = Color3.fromRGB(255, 200, 80), Size = Vector3.one * 0.8, CFrame = CFrame.new(pos) }, FxLocal)
	new("PointLight", { Color = Color3.fromRGB(255, 190, 90), Range = 10, Brightness = 3 }, p)
	Debris:AddItem(p, 0.05)
end

-- white = body, yellow = headshot, blue = shield, grey = structure
function Effects.damageNumber(pos: Vector3, dmg: number, kind: string)
	local p = new("Part", { Anchored = true, CanCollide = false, CanQuery = false, Transparency = 1, Size = Vector3.one * 0.2, CFrame = CFrame.new(pos) }, FxLocal)
	local bb = new("BillboardGui", { Size = UDim2.new(0, 100, 0, 50), AlwaysOnTop = true, StudsOffset = Vector3.new(math.random(-10, 10) / 10, 1, 0), LightInfluence = 0 }, p)
	local col = (kind == "head" and Color3.fromRGB(255, 215, 40)) or (kind == "shield" and Color3.fromRGB(110, 200, 255)) or (kind == "build" and Color3.fromRGB(190, 190, 190)) or WHITE
	local l = text(bb, tostring(dmg), UDim2.fromScale(1, 1), UDim2.new(), FONT_H, kind == "head" and 36 or 28, col)
	l.TextStrokeTransparency = 0
	TweenService:Create(bb, TweenInfo.new(0.7), { StudsOffset = bb.StudsOffset + Vector3.new(0, 3, 0) }):Play()
	TweenService:Create(l, TweenInfo.new(0.7, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	Debris:AddItem(p, 0.75)
end

function Effects.hitMarker(color: Color3)
	local hm = Hud.UI.HitMark
	hm.TextColor3 = color
	hm.TextTransparency = 0
	TweenService:Create(hm, TweenInfo.new(0.25), { TextTransparency = 1 }):Play()
end

return Effects
