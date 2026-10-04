-- Weapons: firing guns, swinging the pickaxe and using heals (the server decides the real hits)

local Core = require(script.Parent.Core)
local Hud = require(script.Parent.Hud)
local Effects = require(script.Parent.Effects)
local C, Net, S = Core.C, Core.Net, Core.S

local Weapons = {}

local function muzzlePos(): Vector3?
	local ch = Core.plr.Character
	local held = ch and ch:FindFirstChild("HeldItem")
	local mz = held and held:FindFirstChild("Muzzle", true)
	if mz and mz:IsA("Attachment") then
		return mz.WorldPosition
	end
	return nil
end

function Weapons.shoot()
	local ch, _, hrp = Core.myChar()
	if not ch or not hrp or ch:GetAttribute("Drop") then
		return
	end
	local it = Core.equipped()
	if not it then
		return
	end
	local now = os.clock()
	if it.Id == "Pickaxe" then
		if now - S.LastShot >= 1 / C.Pickaxe.Rate then
			S.LastShot = now
			local o, d = Core.screenRay()
			Net:FireServer("Fire", o, d, false)
		end
		return
	end
	if C.Consumables[it.Id] then
		if not S.Using then
			Net:FireServer("Use")
		end
		S.Firing = false
		return
	end
	local w = C.Weapons[it.Id]
	if not w or now - S.LastShot < 1 / w.Rate then
		return
	end
	if (it.Mag or 0) <= 0 then
		Net:FireServer("Reload")
		S.Firing = false
		return
	end
	S.LastShot = now
	it.Mag -= 1 -- predicted; the server's inventory sync corrects it
	local o, d = Core.screenRay()
	Net:FireServer("Fire", o, d, S.ADS)
	local muzzle = muzzlePos() or hrp.Position
	Effects.muzzleFlash(muzzle)
	local params = Core.rayParams()
	for _ = 1, (w.Pellets or 1) do
		local dd = w.Pellets and Core.spreadDir(d, w.Spread) or d
		local r = workspace:Raycast(o, dd * w.Range, params)
		Effects.tracer(muzzle, r and r.Position or (o + dd * w.Range))
	end
	S.Bloom = math.min(1, S.Bloom + (w.Pellets and 0.7 or 0.22))
	Hud.refreshInv()
	if not w.Auto then
		S.Firing = false
	end
end

return Weapons
