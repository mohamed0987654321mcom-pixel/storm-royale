-- Combat: shooting, pickaxe, damage (shield first), reloading, healing, destroying structures

local Players = game:GetService("Players")
local Debris = game:GetService("Debris")

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local Building = require(script.Parent.Building)
local C, Net = Core.C, Core.Net
local getChar, getMode, aliveHum = Core.getChar, Core.getMode, Core.aliveHum
local sync = Inventory.sync

local Combat = {}

function Combat.ownerOfModel(model: Instance)
	local plr = Players:GetPlayerFromCharacter(model)
	if plr then
		return Core.Owners[plr]
	end
	return Core.Owners[model]
end

local function charFrom(part: Instance): Model?
	local a = part.Parent
	if a and a:FindFirstChildOfClass("Humanoid") then
		return a :: Model
	end
	local b = a and a.Parent
	if b and b:FindFirstChildOfClass("Humanoid") then
		return b :: Model
	end
	return nil
end

-- warm-up players can only hurt warm-up players; match players only match players
local function sameZone(a, b): boolean
	local ma, mb = getMode(a), getMode(b)
	if ma == "Warmup" then
		return mb == "Warmup"
	end
	return ma == "Match" and mb == "Match"
end

local function hitFx(o, pos: Vector3, dmg: number, kind: string)
	if not o.IsBot and dmg > 0 then
		Net:FireClient(o.Player, "Hit", pos, math.floor(dmg + 0.5), kind)
	end
end

-- returns damage dealt, and whether it only hit shield
function Combat.damageOwner(victim, amount: number, attacker, weaponName: string, ignoreShield: boolean?): (number, boolean)
	local char = getChar(victim)
	local hum = aliveHum(victim)
	if not char or not hum then
		return 0, false
	end
	local shield = char:GetAttribute("Shield") or 0
	local toShield = ignoreShield and 0 or math.min(shield, amount)
	if toShield > 0 then
		char:SetAttribute("Shield", shield - toShield)
	end
	local rest = amount - toShield
	if attacker then
		victim.LastAttacker = attacker
		victim.LastWeapon = weaponName
		victim.LastHitT = os.clock()
		if victim.IsBot then
			victim.ShotBy = attacker
			victim.ShotT = os.clock()
		end
	end
	if not victim.IsBot then
		Net:FireClient(victim.Player, "Hurt", amount)
	end
	if rest > 0 then
		hum.Health = math.max(0, hum.Health - rest)
	end
	return amount, toShield > 0 and rest <= 0
end

local function damageableFrom(part: Instance): Instance?
	if part:GetAttribute("HP") then
		return part
	end
	local p = part.Parent
	if p and p:GetAttribute("HP") then
		return p
	end
	return nil
end

local function destroyObject(obj: Instance)
	local key = obj:GetAttribute("Key")
	if key then
		Building.Builds[key] = nil
	end
	local pos, color = Vector3.zero, Color3.new(0.6, 0.6, 0.6)
	if obj:IsA("Model") then
		pos = obj:GetPivot().Position
		local bp = obj:FindFirstChildWhichIsA("BasePart")
		if bp then
			color = bp.Color
		end
	elseif obj:IsA("BasePart") then
		pos, color = obj.Position, obj.Color
	end
	for _ = 1, 6 do
		local d = Core.P(Core.FxF, Vector3.one * (math.random() + 0.8), CFrame.new(pos + Vector3.new(math.random(-3, 3), math.random(0, 4), math.random(-3, 3))), color, Enum.Material.SmoothPlastic, false)
		d.CanCollide = false
		d.AssemblyLinearVelocity = Vector3.new(math.random(-20, 20), math.random(15, 35), math.random(-20, 20))
		Debris:AddItem(d, 1.2)
	end
	obj:Destroy()
end

local function damageObject(obj: Instance, amount: number, attacker, isPickaxe: boolean)
	local hp = obj:GetAttribute("HP")
	if not hp then
		return
	end
	if isPickaxe and attacker then
		local kind = obj:GetAttribute("Harvest")
		if kind then
			Inventory.giveMat(attacker, kind, math.random(6, 12))
			sync(attacker)
		end
	end
	hp -= amount
	if hp <= 0 then
		destroyObject(obj)
	else
		obj:SetAttribute("HP", hp)
	end
end

local function spreadDir(dir: Vector3, deg: number): Vector3
	if deg <= 0 then
		return dir
	end
	local a = math.random() * math.pi * 2
	local r = math.rad(deg) * math.sqrt(math.random())
	return (CFrame.lookAt(Vector3.zero, dir) * CFrame.Angles(0, 0, a) * CFrame.Angles(r, 0, 0)).LookVector
end

function Combat.cancelActions(o)
	o.ReloadToken = nil
	o.Reloading = false
	o.UseToken = nil
	if not o.IsBot then
		Net:FireClient(o.Player, "Progress", "", 0)
	end
end

function Combat.startReload(o)
	local inv = o.Inv
	local item = inv.Slots[inv.Eq]
	local w = item and C.Weapons[item.Id]
	if not w or o.Reloading or item.Mag >= w.Mag then
		return
	end
	local warm = getMode(o) == "Warmup"
	if inv.Ammo[w.Ammo] <= 0 and not warm then
		Core.toast(o.Player, "No " .. w.Ammo .. " ammo!")
		return
	end
	o.Reloading = true
	local token = {}
	o.ReloadToken = token
	local rt = w.Reload * (1 - ((item.R or 1) - 1) * 0.04)
	if not o.IsBot then
		Net:FireClient(o.Player, "Progress", "Reloading", rt)
	end
	task.delay(rt, function()
		if o.ReloadToken ~= token then
			return
		end
		o.Reloading = false
		if inv.Slots[inv.Eq] ~= item then
			return
		end
		local need = w.Mag - item.Mag
		local take = warm and need or math.min(need, inv.Ammo[w.Ammo])
		if not warm then
			inv.Ammo[w.Ammo] -= take
		end
		item.Mag += take
		sync(o)
	end)
end

function Combat.equip(o, slot: number)
	if slot < 1 or slot > C.SLOTS or o.Inv.Eq == slot then
		return
	end
	o.Inv.Eq = slot
	Combat.cancelActions(o)
	sync(o)
	Inventory.updateHeld(o)
	local item = o.Inv.Slots[slot]
	if item and C.Weapons[item.Id] and item.Mag <= 0 then
		Combat.startReload(o)
	end
end

function Combat.shotParams(char: Model): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { char, Core.FxF, Core.LootF, Core.MenuF }
	return params
end

local function swingPickaxe(o, char: Model, origin: Vector3, dir: Vector3)
	Inventory.swingPose(char)
	local r = workspace:Raycast(origin, dir * C.Pickaxe.Range, Combat.shotParams(char))
	if not r then
		return
	end
	local tc = charFrom(r.Instance)
	local v = tc and Combat.ownerOfModel(tc)
	if v then
		if v ~= o and sameZone(o, v) then
			local dmg = Combat.damageOwner(v, C.Pickaxe.Damage, o, C.Pickaxe.Name)
			hitFx(o, r.Position, dmg, "body")
		end
	else
		local obj = damageableFrom(r.Instance)
		if obj then
			damageObject(obj, C.Pickaxe.BuildDamage, o, true)
			hitFx(o, r.Position, C.Pickaxe.BuildDamage, "build")
		end
	end
end

-- server-authoritative shot: validates rate/ammo, applies spread, raycasts, deals damage
function Combat.fireWeapon(o, origin: Vector3, dir: Vector3, ads: boolean)
	local inv = o.Inv
	local item = inv.Slots[inv.Eq]
	local char = getChar(o)
	local hum = aliveHum(o)
	if not item or not char or not hum or dir.Magnitude < 0.5 then
		return
	end
	local mode = getMode(o)
	if (mode ~= "Match" and mode ~= "Warmup") or char:GetAttribute("Drop") or o.UseToken then
		return
	end
	local head = char:FindFirstChild("Head") :: BasePart?
	if not head then
		return
	end
	dir = dir.Unit
	if (origin - head.Position).Magnitude > 20 then
		origin = head.Position
	end
	-- start the ray beside the character so walls behind the camera don't block it
	origin += dir * math.max(0, (head.Position - origin):Dot(dir) - 1.5)
	local now = os.clock()
	if item.Id == "Pickaxe" then
		if now - (o.LastFire or 0) >= (1 / C.Pickaxe.Rate) * 0.85 then
			o.LastFire = now
			swingPickaxe(o, char, origin, dir)
		end
		return
	end
	local w = C.Weapons[item.Id]
	if not w or o.Reloading or now - (o.LastFire or 0) < (1 / w.Rate) * 0.85 then
		return
	end
	if (item.Mag or 0) <= 0 then
		Combat.startReload(o)
		return
	end
	local rested = now - (o.LastFire or 0) > 0.45
	o.LastFire = now
	item.Mag -= 1
	local mult = C.Rarities[item.R or 1].Mult
	local spread = ads and w.Ads or w.Spread
	if hum.MoveDirection.Magnitude > 0.1 then
		spread *= 1.35
	end
	if hum.FloorMaterial == Enum.Material.Air then
		spread *= 1.8
	end
	if rested and ads and not w.Pellets and hum.MoveDirection.Magnitude < 0.1 then
		spread = 0 -- first-shot accuracy
	end
	if o.IsBot then
		spread += o.AimError or 2
	end
	local muzzle = head.Position
	local held = char:FindFirstChild("HeldItem")
	local mz = held and held:FindFirstChild("Muzzle", true)
	if mz and mz:IsA("Attachment") then
		muzzle = mz.WorldPosition
	end
	local params = Combat.shotParams(char)
	local ends = {}
	local hits = {}
	for _ = 1, (w.Pellets or 1) do
		local d = spreadDir(dir, spread)
		local r = workspace:Raycast(origin, d * w.Range, params)
		local hitPos = r and r.Position or (origin + d * w.Range)
		table.insert(ends, hitPos)
		if r then
			local tc = charFrom(r.Instance)
			local v = tc and Combat.ownerOfModel(tc)
			if v then
				if v ~= o and sameZone(o, v) then
					local isHead = r.Instance.Name == "Head"
					local acc = hits[v] or { Dmg = 0, Head = false, Pos = hitPos }
					acc.Dmg += w.Damage * mult * (isHead and w.Head or 1)
					acc.Head = acc.Head or isHead
					hits[v] = acc
				end
			else
				local obj = damageableFrom(r.Instance)
				if obj then
					damageObject(obj, w.Damage * mult, o, false)
					hitFx(o, hitPos, w.Damage * mult, "build")
				end
			end
		end
	end
	for v, acc in hits do
		local dealt, shieldOnly = Combat.damageOwner(v, math.floor(acc.Dmg + 0.5), o, w.Name)
		hitFx(o, acc.Pos, dealt, acc.Head and "head" or (shieldOnly and "shield" or "body"))
	end
	Net:FireAllClients("Tracer", o.Name, muzzle, ends)
	if item.Mag <= 0 then
		Combat.startReload(o)
	end
	sync(o)
end

function Combat.useItem(o)
	local inv = o.Inv
	local slot = inv.Eq
	local item = inv.Slots[slot]
	local cd = item and C.Consumables[item.Id]
	local char = getChar(o)
	local hum = aliveHum(o)
	if not cd or o.UseToken or not char or not hum then
		return
	end
	if cd.Heal and hum.Health >= cd.Cap then
		Core.toast(o.Player, "Can't heal above " .. cd.Cap .. " with " .. cd.Name)
		return
	end
	if cd.Shield and (char:GetAttribute("Shield") or 0) >= cd.Cap then
		Core.toast(o.Player, "Shield is full!")
		return
	end
	local token = {}
	o.UseToken = token
	if not o.IsBot then
		Net:FireClient(o.Player, "Progress", "Using " .. cd.Name, cd.Time)
	end
	task.delay(cd.Time, function()
		if o.UseToken ~= token then
			return
		end
		o.UseToken = nil
		if inv.Slots[slot] ~= item or not aliveHum(o) then
			return
		end
		if cd.Heal then
			hum.Health = math.max(hum.Health, math.min(cd.Cap, hum.Health + cd.Heal))
		else
			local s = char:GetAttribute("Shield") or 0
			char:SetAttribute("Shield", math.max(s, math.min(cd.Cap, s + cd.Shield)))
		end
		item.N -= 1
		if item.N <= 0 then
			inv.Slots[slot] = false
			Inventory.updateHeld(o)
		end
		sync(o)
	end)
end

return Combat
