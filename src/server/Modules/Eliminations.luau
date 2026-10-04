-- Eliminations: kill credit, kill feed, placement, loot drop, warm-up respawns

local Debris = game:GetService("Debris")

local Core = require(script.Parent.Core)
local Inventory = require(script.Parent.Inventory)
local Loot = require(script.Parent.Loot)
local Cosmetics = require(script.Parent.Cosmetics)
local C, Net = Core.C, Core.Net

local Eliminations = {}

function Eliminations.onEliminated(o, char: Model)
	if o.Dead == char then
		return
	end
	o.Dead = char
	Cosmetics.removeGlider(char)
	local mode = Core.getMode(o)
	if mode == "Warmup" or mode == "Menu" then
		task.delay(2.5, function()
			if o.Player.Parent and o.Player:GetAttribute("Mode") == mode then
				o.Player:LoadCharacter()
			end
		end)
		return
	end
	local Match = Core.Match
	if not Match.Alive[o] then
		return
	end
	Match.Alive[o] = nil
	local placement = Core.aliveCount() + 1
	local killer = o.LastAttacker
	if not o.LastHitT or os.clock() - o.LastHitT > 12 then
		killer = nil
	end
	local hrp = char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if hrp then
		Loot.dropAll(o, hrp.Position)
	end
	o.Inv = Inventory.newInv()
	Inventory.sync(o)
	if killer and killer ~= o then
		killer.Kills = (killer.Kills or 0) + 1
		if not killer.IsBot then
			killer.Player:SetAttribute("Kills", killer.Kills)
			Core.addStat(killer.Player, "Kills", 1)
			Core.addStat(killer.Player, "Coins", C.Coins.Kill)
			Net:FireClient(killer.Player, "Elim", o.Name, killer.Kills)
		end
		Net:FireAllClients("Feed", killer.Name, o.Name, o.LastWeapon or "")
	else
		Net:FireAllClients("Feed", "", o.Name, (os.clock() - (o.StormT or 0) < 2) and "Storm" or "")
	end
	if o.IsBot then
		Core.Owners[char] = nil
		Debris:AddItem(char, 4)
	else
		o.Player:SetAttribute("Mode", "Dead")
		Core.addStat(o.Player, "Matches", 1)
		Core.addStat(o.Player, "Coins", C.Coins.Match)
		Net:FireClient(o.Player, "Placement", placement, o.Kills or 0, killer and killer.Name or "")
		Core.saveData(o.Player)
	end
	Core.updateAlive()
end

return Eliminations
