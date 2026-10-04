-- Remotes: every request the client can send, validated before anything happens

local Core = require(script.Parent.Core)
local Combat = require(script.Parent.Combat)
local Building = require(script.Parent.Building)
local Cosmetics = require(script.Parent.Cosmetics)
local SkyBus = require(script.Parent.SkyBus)
local PlayerFlow = require(script.Parent.PlayerFlow)
local Inventory = require(script.Parent.Inventory)
local C, Net = Core.C, Core.Net
local Owners, Data = Core.Owners, Core.Data

local Remotes = {}
local Handlers = {}

Handlers.Play = function(plr: Player)
	if plr:GetAttribute("Mode") == "Menu" then
		PlayerFlow.sendToWarmup(plr)
	end
end

Handlers.Menu = function(plr: Player)
	local m = plr:GetAttribute("Mode")
	if m == "Warmup" or m == "Dead" then
		PlayerFlow.sendToMenu(plr)
	end
end

Handlers.Fire = function(plr: Player, origin, dir, ads)
	local o = Owners[plr]
	if o and typeof(origin) == "Vector3" and typeof(dir) == "Vector3" then
		Combat.fireWeapon(o, origin, dir, ads == true)
	end
end

Handlers.Equip = function(plr: Player, slot)
	local o = Owners[plr]
	if o and type(slot) == "number" then
		Combat.equip(o, math.floor(slot))
	end
end

Handlers.Reload = function(plr: Player)
	local o = Owners[plr]
	if o then
		Combat.startReload(o)
	end
end

Handlers.Use = function(plr: Player)
	local o = Owners[plr]
	if o and Core.getMode(o) ~= "Menu" then
		Combat.useItem(o)
	end
end

Handlers.Build = function(plr: Player, kind, cx, ly, cz, dir)
	local o = Owners[plr]
	if o and type(kind) == "string" and type(cx) == "number" and type(ly) == "number" and type(cz) == "number" and type(dir) == "number" then
		Building.placePiece(o, kind, cx, ly, cz, dir)
	end
end

Handlers.Mat = function(plr: Player, idx)
	local o = Owners[plr]
	if o and type(idx) == "number" and C.MatOrder[idx] then
		o.Inv.MatSel = idx
		Inventory.sync(o)
	end
end

Handlers.JumpBus = function(plr: Player)
	local o = Owners[plr]
	if o and Core.Match.DoorsOpen then
		SkyBus.jump(o)
	end
end

Handlers.Glide = function(plr: Player)
	local ch = plr.Character
	if ch and ch:GetAttribute("Drop") == "Sky" then
		ch:SetAttribute("Drop", "Glide")
		Cosmetics.attachGlider(ch, Data[plr] and Data[plr].Glider)
	end
end

Handlers.Landed = function(plr: Player)
	local ch = plr.Character
	if ch and ch:GetAttribute("Drop") then
		ch:SetAttribute("Drop", nil)
		Cosmetics.removeGlider(ch)
	end
end

Handlers.Thanks = function(plr: Player)
	if plr:GetAttribute("Mode") == "Bus" and not plr:GetAttribute("Thanked") then
		plr:SetAttribute("Thanked", true)
		Net:FireAllClients("Feed", plr.Name, "the bus driver", "Thanks")
		task.delay(C.BUS_TIME, function()
			plr:SetAttribute("Thanked", nil)
		end)
	end
end

Handlers.Buy = function(plr: Player, id)
	local d = Data[plr]
	if not d or type(id) ~= "string" or d.Owned[id] then
		return
	end
	local item = Cosmetics.find(id)
	if not item then
		return
	end
	if d.Coins < item.Price then
		Core.toast(plr, "Not enough coins! Win matches and get eliminations to earn more.")
		return
	end
	d.Coins -= item.Price
	d.Owned[id] = true
	Core.pushData(plr)
	Core.saveData(plr)
	Core.toast(plr, "Purchased " .. item.Name .. "!")
end

Handlers.Cosmetic = function(plr: Player, id)
	local d = Data[plr]
	if not d or type(id) ~= "string" then
		return
	end
	local item, kind = Cosmetics.find(id)
	if not item or not kind or not d.Owned[id] then
		return
	end
	d[kind] = id
	Core.pushData(plr)
	if kind == "Outfit" and plr.Character then
		if id == "Default" then
			if plr:GetAttribute("Mode") == "Menu" then
				task.spawn(function()
					plr:LoadCharacter()
				end)
			end
		else
			Cosmetics.applyOutfit(plr.Character, id)
		end
	end
end

function Remotes.connect()
	Net.OnServerEvent:Connect(function(plr, action, ...)
		local h = type(action) == "string" and Handlers[action]
		if h then
			local ok, err = pcall(h, plr, ...)
			if not ok then
				warn("[StormRoyale] " .. tostring(action) .. ": " .. tostring(err))
			end
		end
	end)
end

return Remotes
