-- PlayerFlow: joining, the lobby stage, the warm-up island and respawning

local Players = game:GetService("Players")

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local Combat = require(script.Parent.Combat)
local Cosmetics = require(script.Parent.Cosmetics)
local Avatar = require(script.Parent.Avatar)
local Eliminations = require(script.Parent.Eliminations)
local World = require(script.Parent.World)
local C = Core.C

local PlayerFlow = {}

local PadPos: { [number]: Vector3 } = {}
local SlotUsed: { [number]: Player } = {}

local function warmupSpawn(): CFrame
	local W = C.WARMUP_CENTER
	local a, r = math.random() * math.pi * 2, math.random(10, 90)
	local x, z = W.X + math.cos(a) * r, W.Z + math.sin(a) * r
	return CFrame.new(x, Core.groundY(x, z) + 5, z)
end

local function giveWarmupKit(o)
	local inv = Inventory.newInv()
	inv.Slots[2] = { Id = "AR", R = 3, Mag = 30 }
	inv.Slots[3] = { Id = "Shotgun", R = 3, Mag = 5 }
	inv.Slots[4] = { Id = "SMG", R = 2, Mag = 30 }
	inv.Slots[5] = { Id = "Sniper", R = 4, Mag = 1 }
	inv.Slots[6] = { Id = "ShieldPotion", N = 3 }
	for k in inv.Ammo do
		inv.Ammo[k] = 999
	end
	for k in inv.Mats do
		inv.Mats[k] = 999
	end
	o.Inv = inv
	Inventory.sync(o)
	Inventory.updateHeld(o)
end

function PlayerFlow.sendToMenu(plr: Player)
	local o = Core.Owners[plr]
	if not o then
		return
	end
	plr:SetAttribute("Mode", "Menu")
	o.Inv = Inventory.newInv()
	Combat.cancelActions(o)
	Inventory.sync(o)
	task.spawn(function()
		Avatar.spawn(plr)
	end)
end

function PlayerFlow.sendToWarmup(plr: Player)
	plr:SetAttribute("Mode", "Warmup")
	task.spawn(function()
		Avatar.spawn(plr)
	end)
end

function PlayerFlow.warmupPlayers()
	local list = {}
	for _, plr in Players:GetPlayers() do
		if plr:GetAttribute("Mode") == "Warmup" and Core.Owners[plr] then
			table.insert(list, Core.Owners[plr])
		end
	end
	return list
end

local function onCharacter(plr: Player, char: Model)
	local o = Core.Owners[plr]
	if not o then
		return
	end
	local hum = char:WaitForChild("Humanoid") :: Humanoid
	char:WaitForChild("HumanoidRootPart")
	o.Dead = nil
	hum.MaxHealth = 100
	hum.Health = 100
	hum.UseJumpPower = true
	char:SetAttribute("Shield", 0)
	hum.Died:Connect(function()
		Eliminations.onEliminated(o, char)
	end)
	task.wait()
	local mode = plr:GetAttribute("Mode")
	if mode == "Menu" then
		local pad = PadPos[(plr:GetAttribute("Slot") :: number?) or 1] or C.MENU_POS
		char:PivotTo(CFrame.lookAt(pad + Vector3.new(0, 3, 0), pad + Vector3.new(0, 3, -1)))
		hum.WalkSpeed = 0
		hum.JumpPower = 0
	else
		hum.WalkSpeed = 20
		hum.JumpPower = 50
		if mode == "Warmup" then
			char:PivotTo(warmupSpawn())
			giveWarmupKit(o)
		end
	end
	local d = Core.Data[plr]
	if d then
		Cosmetics.applyOutfit(char, d.Outfit)
	end
	Inventory.updateHeld(o)
end

local function onPlayerAdded(plr: Player)
	local slot = 1
	while SlotUsed[slot] do
		slot += 1
	end
	SlotUsed[slot] = plr
	if not PadPos[slot] then
		PadPos[slot] = World.makePad(slot)
	end
	plr:SetAttribute("Slot", slot)
	plr:SetAttribute("PadPos", PadPos[slot])
	plr:SetAttribute("Mode", "Menu")
	plr:SetAttribute("Kills", 0)
	Core.Owners[plr] = { Key = plr, IsBot = false, Player = plr, Name = plr.Name, Inv = Inventory.newInv(), Kills = 0 }
	plr.CharacterAdded:Connect(function(char)
		onCharacter(plr, char)
	end)
	plr.CharacterAppearanceLoaded:Connect(function(char)
		local d = Core.Data[plr]
		if d then
			Cosmetics.applyOutfit(char, d.Outfit)
		end
	end)
	Core.loadData(plr)
	Inventory.sync(Core.Owners[plr])
	Avatar.spawn(plr)
end

function PlayerFlow.start()
	Players.CharacterAutoLoads = false
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, plr in Players:GetPlayers() do
		task.spawn(onPlayerAdded, plr)
	end
	Players.PlayerRemoving:Connect(function(plr)
		Core.saveData(plr)
		local o = Core.Owners[plr]
		if o and Core.Match.Alive[o] then
			Core.Match.Alive[o] = nil
			Core.updateAlive()
		end
		SlotUsed[plr:GetAttribute("Slot") or 0] = nil
		Core.Owners[plr] = nil
		Core.Data[plr] = nil
	end)
	game:BindToClose(function()
		for _, p in Players:GetPlayers() do
			Core.saveData(p)
		end
	end)
end

return PlayerFlow
