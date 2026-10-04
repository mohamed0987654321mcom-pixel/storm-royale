-- StormFX: the purple storm wall and the screen tint when you're caught outside

local Lighting = game:GetService("Lighting")

local Core = require(script.Parent.Core)
local Hud = require(script.Parent.Hud)
local C, State, S = Core.C, Core.State, Core.S
local new = Core.new

local StormFX = {}

local Folder = new("Folder", { Name = "BR_StormFX" }, nil)
local SEG = 72
local segs: { BasePart } = {}
for i = 1, SEG do
	segs[i] = new("Part", { Anchored = true, CanCollide = false, CanQuery = false, CanTouch = false, CastShadow = false, Material = Enum.Material.ForceField, Color = Color3.fromRGB(160, 70, 255), Size = Vector3.new(10, 1400, 1) }, Folder)
end
local tint = new("ColorCorrectionEffect", { Name = "StormTint", TintColor = Color3.fromRGB(205, 160, 255), Saturation = -0.25, Contrast = 0.1, Enabled = false }, Lighting)

function StormFX.update(show: boolean, now: number)
	local warn = Hud.UI.StormWarn
	if not show then
		Folder.Parent = nil
		tint.Enabled = false
		warn.Visible = false
		return
	end
	Folder.Parent = workspace
	local c, r = C.StormAt(State, now)
	local segW = math.max(0.5, 2 * math.pi * r / SEG + 1)
	local center = Vector3.new(c.X, 200, c.Y)
	for i, p in segs do
		local a = (i - 0.5) / SEG * math.pi * 2
		local pos = Vector3.new(c.X + math.cos(a) * r, 200, c.Y + math.sin(a) * r)
		p.Size = Vector3.new(segW, 1400, 1)
		p.CFrame = CFrame.lookAt(pos, center)
	end
	local _, _, hrp = Core.myChar()
	local inside = true
	if hrp then
		inside = (Vector2.new(hrp.Position.X, hrp.Position.Z) - c).Magnitude <= r
	end
	tint.Enabled = not inside and S.Mode == "Match"
	warn.Visible = not inside and S.Mode == "Match"
end

return StormFX
