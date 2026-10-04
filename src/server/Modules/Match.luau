-- Match: countdown → Sky Bus → storm → last one standing → back to the lobby

local Players = game:GetService("Players")

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local Combat = require(script.Parent.Combat)
local Building = require(script.Parent.Building)
local Loot = require(script.Parent.Loot)
local World = require(script.Parent.World)
local Bots = require(script.Parent.Bots)
local SkyBus = require(script.Parent.SkyBus)
local Storm = require(script.Parent.Storm)
local PlayerFlow = require(script.Parent.PlayerFlow)
local WebLink = require(script.Parent.WebLink)
local C, Net, State = Core.C, Core.Net, Core.State

local MatchFlow = {}

local function runMatch()
	local Match = Core.Match
	Match.Id += 1
	local id = Match.Id
	table.clear(Match.Alive)
	local parts = PlayerFlow.warmupPlayers()
	if #parts == 0 then
		return
	end
	for _, o in parts do
		local plr = o.Player
		o.Inv = Inventory.newInv()
		o.Kills = 0
		o.LastAttacker = nil
		Combat.cancelActions(o)
		plr:SetAttribute("Kills", 0)
		plr:SetAttribute("Mode", "Bus")
		local ch = plr.Character
		local hum = ch and ch:FindFirstChildOfClass("Humanoid")
		if not ch or not hum or hum.Health <= 0 then
			plr:LoadCharacter()
			ch = plr.Character
			hum = ch and ch:FindFirstChildOfClass("Humanoid")
		end
		if ch and hum then
			hum.Health = 100
			ch:SetAttribute("Shield", 0)
			ch:SetAttribute("Drop", nil)
			local hrp = ch:FindFirstChild("HumanoidRootPart") :: BasePart?
			if hrp then
				hrp.Anchored = true
			end
		end
		Inventory.sync(o)
		Inventory.updateHeld(o)
		Match.Alive[o] = true
	end
	Bots.clear()
	local bots = {}
	for _ = 1, math.max(0, C.TOTAL_PLAYERS - #parts) do
		local b = Bots.create()
		if b then
			table.insert(bots, b)
			Match.Alive[b] = true
		end
	end
	Core.updateAlive()
	Storm.reset()
	task.spawn(Storm.run, id)
	task.spawn(Storm.damageLoop, id)
	SkyBus.run(parts, bots)
	State:SetAttribute("Phase", "Playing")
	while Core.aliveCount() > 1 and Core.playerAlive() do
		task.wait(0.5)
	end
	State:SetAttribute("Phase", "Ended")
	local winner = (Core.aliveCount() == 1) and next(Match.Alive) or nil
	if winner then
		Net:FireAllClients("Winner", winner.Name)
		if not winner.IsBot then
			local wp = winner.Player
			Core.addStat(wp, "Wins", 1)
			Core.addStat(wp, "Matches", 1)
			Core.addStat(wp, "Coins", C.Coins.Win + C.Coins.Match)
			Net:FireClient(wp, "Victory", winner.Kills or 0)
			WebLink.reportMatch(wp, winner.Kills or 0, 1, true)
			Core.saveData(wp)
		end
	end
	task.wait(9)
	Match.Id += 1
	for _, plr in Players:GetPlayers() do
		local m = plr:GetAttribute("Mode")
		if m == "Match" or m == "Dead" or m == "Bus" then
			PlayerFlow.sendToMenu(plr)
		end
	end
	Bots.clear()
	table.clear(Match.Alive)
	Core.updateAlive()
	Storm.reset()
	Building.clear()
	World.buildMap()
	Loot.resetLoot()
end

local function abortMatch()
	Core.Match.Id += 1
	Bots.clear()
	table.clear(Core.Match.Alive)
	Core.updateAlive()
	for _, plr in Players:GetPlayers() do
		if plr:GetAttribute("Mode") ~= "Menu" then
			PlayerFlow.sendToMenu(plr)
		end
	end
end

function MatchFlow.startLoop()
	task.spawn(function()
		while true do
			State:SetAttribute("Phase", "Waiting")
			repeat
				task.wait(1)
				State:SetAttribute("Ready", #PlayerFlow.warmupPlayers())
			until #PlayerFlow.warmupPlayers() >= C.MIN_READY
			State:SetAttribute("Phase", "Countdown")
			local cancelled = false
			for t = C.COUNTDOWN, 1, -1 do
				State:SetAttribute("Countdown", t)
				State:SetAttribute("Ready", #PlayerFlow.warmupPlayers())
				task.wait(1)
				if #PlayerFlow.warmupPlayers() < C.MIN_READY then
					cancelled = true
					break
				end
			end
			if not cancelled then
				local ok, err = pcall(runMatch)
				if not ok then
					warn("[StormRoyale] match error: " .. tostring(err))
					abortMatch()
				end
			end
		end
	end)
end

return MatchFlow
