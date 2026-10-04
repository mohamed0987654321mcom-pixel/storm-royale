-- Bots: AI players that drop, loot, fight, heal, build walls and run from the storm

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local Loot = require(script.Parent.Loot)
local Combat = require(script.Parent.Combat)
local Building = require(script.Parent.Building)
local Cosmetics = require(script.Parent.Cosmetics)
local Eliminations = require(script.Parent.Eliminations)
local C, State = Core.C, Core.State
local getChar, getMode, aliveHum = Core.getChar, Core.getMode, Core.aliveHum

local Bots = {}

local NAMES = { "Raptor", "Blaze", "Nova", "Viper", "Echo", "Ghost", "Titan", "Pixel", "Comet", "Bolt", "Rogue", "Fang", "Jinx", "Orbit", "Spike", "Zephyr", "Onyx", "Flux", "Rift", "Ember" }

function Bots.clear()
	for m, o in Core.Owners do
		if o.IsBot then
			Core.Owners[m] = nil
		end
	end
	Core.BotF:ClearAllChildren()
end

function Bots.create()
	local desc = Instance.new("HumanoidDescription")
	local skin = Color3.fromHSV(0.07, 0.25 + math.random() * 0.4, 0.35 + math.random() * 0.6)
	desc.HeadColor, desc.LeftArmColor, desc.RightArmColor = skin, skin, skin
	desc.TorsoColor = Color3.fromHSV(math.random(), 0.7, 0.8)
	local pants = Color3.fromHSV(math.random(), 0.5, 0.35)
	desc.LeftLegColor, desc.RightLegColor = pants, pants
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	end)
	if not ok or not model then
		return nil
	end
	local name = NAMES[math.random(#NAMES)] .. "_" .. math.random(10, 99)
	model.Name = name
	local hum = model:FindFirstChildOfClass("Humanoid") :: Humanoid
	local hrp = model:FindFirstChild("HumanoidRootPart") :: BasePart
	hum.DisplayName = name
	hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	hum.MaxHealth = 100
	hum.Health = 100
	hum.WalkSpeed = 18
	model:SetAttribute("Shield", 0)
	hrp.Anchored = true
	model:PivotTo(CFrame.new(math.random(-50, 50), 2500, math.random(-50, 50))) -- parked until they jump
	model.Parent = Core.BotF
	local o = { Key = model, IsBot = true, Model = model, Name = name, Inv = Inventory.newInv(), Kills = 0, AimError = 1.5 + math.random() * 2.5, Hum = hum, HRP = hrp }
	o.Inv.Mats.Wood = 80
	Core.Owners[model] = o
	hum.Died:Connect(function()
		Eliminations.onEliminated(o, model)
	end)
	local animator = hum:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = hum
	end
	local function anim(id: string): AnimationTrack
		local a = Instance.new("Animation")
		a.AnimationId = id
		return (animator :: Animator):LoadAnimation(a)
	end
	-- Roblox's default R15 run / idle / fall animations
	o.RunAnim = anim("rbxassetid://913376220")
	o.IdleAnim = anim("rbxassetid://507766388")
	o.FallAnim = anim("rbxassetid://507767968")
	o.IdleAnim:Play()
	return o
end

-- skydive then glide from the bus to a landing spot (bots prefer named locations)
function Bots.drop(o, from: Vector3)
	local model, hrp = o.Model, o.HRP
	local target: Vector2
	if math.random() < 0.65 then
		local poi = C.POIs[math.random(#C.POIs)]
		target = poi.Pos + Vector2.new(math.random(-70, 70), math.random(-70, 70))
	else
		local a, r = math.random() * 6.28, math.random(60, C.ISLAND_R - 80)
		target = Vector2.new(math.cos(a) * r, math.sin(a) * r)
	end
	local gy = Core.groundY(target.X, target.Y)
	local land = Vector3.new(target.X, gy + 4, target.Y)
	local mid = from:Lerp(land, 0.65)
	mid = Vector3.new(mid.X, gy + C.GLIDE_AUTO, mid.Z)
	local t1 = math.max(2, (from.Y - mid.Y) / C.SKYDIVE_SPEED)
	local t2 = math.max(2, (mid.Y - land.Y) / C.GLIDE_SPEED)
	local flat = Vector3.new(land.X - from.X, 0, land.Z - from.Z)
	local look = flat.Magnitude > 1 and flat.Unit or Vector3.new(0, 0, -1)
	o.FallAnim:Play()
	local start = os.clock()
	local glided = false
	while model.Parent do
		local t = os.clock() - start
		local pos
		if t < t1 then
			pos = from:Lerp(mid, t / t1)
			hrp.CFrame = CFrame.lookAt(pos, pos + look) * CFrame.Angles(math.rad(-60), 0, 0)
		else
			if not glided then
				glided = true
				Cosmetics.attachGlider(model, C.Gliders[math.random(#C.Gliders)].Id)
			end
			local a = math.min(1, (t - t1) / t2)
			pos = mid:Lerp(land, a)
			hrp.CFrame = CFrame.lookAt(pos, pos + look)
			if a >= 1 then
				break
			end
		end
		RunService.Heartbeat:Wait()
	end
	if not model.Parent then
		return
	end
	Cosmetics.removeGlider(model)
	o.FallAnim:Stop()
	hrp.Anchored = false
	pcall(function()
		hrp:SetNetworkOwner(nil)
	end)
	o.Landed = true
end

local function losTo(o, tc: Model): boolean
	local head = o.Model:FindFirstChild("Head") :: BasePart?
	local th = tc:FindFirstChild("Head") :: BasePart?
	if not head or not th then
		return false
	end
	local r = workspace:Raycast(head.Position, th.Position - head.Position, Combat.shotParams(o.Model))
	return r ~= nil and r.Instance:IsDescendantOf(tc)
end

local function bestGun(o, dist: number): number?
	local inv = o.Inv
	local best, score = nil, -1
	for i = 2, C.SLOTS do
		local it = inv.Slots[i]
		local w = it and C.Weapons[it.Id]
		if w then
			local s = it.R or 1
			if it.Id == "Shotgun" and dist < 25 then
				s += 10
			elseif it.Id == "Sniper" and dist > 110 then
				s += 8
			elseif it.Id == "AR" or it.Id == "SMG" then
				s += 4
			end
			if (it.Mag or 0) <= 0 and inv.Ammo[w.Ammo] <= 0 then
				s = -1
			end
			if s > score then
				best, score = i, s
			end
		end
	end
	return best
end

local function think(o, now: number)
	if not o.Landed or not aliveHum(o) then
		return
	end
	local hum, hrp, inv = o.Hum, o.HRP, o.Inv
	local pos = hrp.Position
	local moving = Vector3.new(hrp.AssemblyLinearVelocity.X, 0, hrp.AssemblyLinearVelocity.Z).Magnitude > 2
	if moving and not o.RunAnim.IsPlaying then
		o.IdleAnim:Stop()
		o.RunAnim:Play()
	elseif not moving and not o.IdleAnim.IsPlaying then
		o.RunAnim:Stop()
		o.IdleAnim:Play()
	end
	if o.LastPos and o.WantsMove and (pos - o.LastPos).Magnitude < 0.6 then
		hum.Jump = true -- stuck: hop
	end
	o.LastPos = pos
	o.WantsMove = false
	local function moveTo(p: Vector3)
		o.WantsMove = true
		hum:MoveTo(p)
	end
	-- nearest enemy
	local target, dist = nil, 170
	for other in Core.Match.Alive do
		if other ~= o then
			local ch = getChar(other)
			local thrp = ch and ch:FindFirstChild("HumanoidRootPart") :: BasePart?
			local ready = (other.IsBot and other.Landed) or (not other.IsBot and getMode(other) == "Match")
			if ch and thrp and ready and not ch:GetAttribute("Drop") then
				local d = (thrp.Position - pos).Magnitude
				if d < dist then
					target, dist = other, d
				end
			end
		end
	end
	local tc = target and getChar(target)
	local visible = tc ~= nil and losTo(o, tc)
	if o.UseToken then
		return
	end
	-- heal when safe
	if not visible or dist > 90 then
		for i = 2, C.SLOTS do
			local it = inv.Slots[i]
			local cd = it and C.Consumables[it.Id]
			if cd and ((cd.Heal and hum.Health < cd.Cap - 10) or (cd.Shield and (o.Model:GetAttribute("Shield") or 0) < cd.Cap - 10)) then
				Combat.equip(o, i)
				Combat.useItem(o)
				hum:MoveTo(pos)
				return
			end
		end
	end
	-- fight
	local gi = bestGun(o, dist)
	if visible and tc and gi then
		if inv.Eq ~= gi then
			Combat.equip(o, gi)
		end
		local it = inv.Slots[gi]
		local aim = (tc:FindFirstChild("UpperTorso") or tc:FindFirstChild("HumanoidRootPart")) :: BasePart?
		local head = o.Model:FindFirstChild("Head") :: BasePart?
		if aim and head then
			hrp.CFrame = CFrame.lookAt(pos, Vector3.new(aim.Position.X, pos.Y, aim.Position.Z))
			if it.Mag <= 0 then
				Combat.startReload(o)
			elseif now >= (o.NextShot or 0) then
				local w = C.Weapons[it.Id]
				Combat.fireWeapon(o, head.Position, aim.Position - head.Position, dist > 60)
				o.NextShot = now + (1 / w.Rate) * (w.Auto and 1.2 or 1.5) + math.random() * 0.3
			end
			-- got shot? throw up a wall
			if o.ShotBy == target and now - (o.ShotT or 0) < 0.6 and now - (o.LastBuild or 0) > 4 and math.random() < 0.4 then
				o.LastBuild = now
				local dv = aim.Position - pos
				local di = math.abs(dv.X) > math.abs(dv.Z) and (dv.X > 0 and 1 or 3) or (dv.Z > 0 and 2 or 4)
				local G = C.GRID
				Building.placePiece(o, "Wall", math.floor(pos.X / G), math.floor((pos.Y - 2) / G), math.floor(pos.Z / G), di)
			end
			if dist > 45 then
				moveTo(aim.Position)
			else
				moveTo(pos + hrp.CFrame.RightVector * (math.random() < 0.5 and -10 or 10))
			end
		end
		return
	end
	-- stay ahead of the storm
	local nextC: Vector2 = State:GetAttribute("StormC1") or Vector2.zero
	local nextR: number = State:GetAttribute("StormR1") or C.STORM_START_R
	if (Vector2.new(pos.X, pos.Z) - nextC).Magnitude > nextR * 0.85 then
		moveTo(Vector3.new(nextC.X, pos.Y, nextC.Y))
		return
	end
	-- go loot
	local lt = o.LootTarget
	if not lt or not lt.Parent or now > (o.LootGiveUp or 0) then
		lt = nil
		local free = Inventory.hasFreeSlot(o)
		local bd = 140
		for _, l in Core.LootF:GetChildren() do
			local id = l:GetAttribute("Item")
			local wanted = l.Name == "Chest" or free or (type(id) == "string" and (string.sub(id, 1, 5) == "Ammo_" or string.sub(id, 1, 4) == "Mat_"))
			if wanted then
				local lp = l:IsA("Model") and l:GetPivot().Position or (l :: BasePart).Position
				local d = (lp - pos).Magnitude
				if d < bd then
					lt, bd = l, d
				end
			end
		end
		o.LootTarget = lt
		o.LootGiveUp = now + 12
	end
	if lt then
		local lp = lt:IsA("Model") and lt:GetPivot().Position or (lt :: BasePart).Position
		if (lp - pos).Magnitude < 7 then
			if lt.Name == "Chest" then
				Loot.openChest(lt :: Model)
			elseif lt:IsA("BasePart") then
				Loot.tryPickup(o, lt)
			end
			o.LootTarget = nil
		else
			moveTo(lp)
		end
		return
	end
	-- wander inside the safe zone
	if not o.Wander or (o.Wander - pos).Magnitude < 8 or now > (o.WanderT or 0) then
		local a, r = math.random() * 6.28, math.random() * nextR * 0.7
		o.Wander = Vector3.new(nextC.X + math.cos(a) * r, pos.Y, nextC.Y + math.sin(a) * r)
		o.WanderT = now + 15
	end
	moveTo(o.Wander)
end

function Bots.startLoop()
	task.spawn(function()
		while true do
			task.wait(0.25)
			local now = os.clock()
			for _, o in Core.Owners do
				if o.IsBot then
					local ok, err = pcall(think, o, now)
					if not ok then
						warn("[StormRoyale] bot error: " .. tostring(err))
					end
				end
			end
		end
	end)
end

return Bots
