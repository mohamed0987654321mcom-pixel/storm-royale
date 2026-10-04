-- Events: messages from the server, and switching screens when your mode changes
-- Modes: Menu (lobby) → Warmup → Bus → Match → Dead (spectating) → Menu

local TweenService = game:GetService("TweenService")

local Core = require(script.Parent.Core)
local Hud = require(script.Parent.Hud)
local Effects = require(script.Parent.Effects)
local Lobby = require(script.Parent.Lobby)
local C, Net, S, plr = Core.C, Core.Net, Core.S, Core.plr
local WHITE, YELLOW, TOUCH = Core.WHITE, Core.YELLOW, Core.TOUCH
local UI = Hud.UI

local Events = {}

local function onServer(action: string, ...)
	local a = { ... }
	if action == "Toast" then
		Core.toast(a[1])
	elseif action == "Hit" then
		Effects.damageNumber(a[1], a[2], a[3])
		Effects.hitMarker(a[3] == "head" and YELLOW or WHITE)
	elseif action == "Hurt" then
		UI.Hurt.BackgroundTransparency = 0.65
		TweenService:Create(UI.Hurt, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
	elseif action == "Tracer" then
		if a[1] ~= plr.Name then
			for _, e in a[3] do
				Effects.tracer(a[2], e)
			end
		end
	elseif action == "Progress" then
		Hud.showProgress(a[1], a[2])
	elseif action == "Feed" then
		local killer, victim, wpn = a[1], a[2], a[3]
		if wpn == "Thanks" then
			Hud.addFeed(killer .. " thanked the bus driver", Color3.fromRGB(150, 220, 255))
		elseif killer == "" then
			Hud.addFeed(victim .. (wpn == "Storm" and " was lost in the storm" or " was eliminated"), Color3.fromRGB(210, 160, 255))
		else
			local col = (killer == plr.Name and YELLOW) or (victim == plr.Name and Color3.fromRGB(255, 120, 120)) or WHITE
			Hud.addFeed(killer .. "  [" .. wpn .. "]  " .. victim, col)
		end
	elseif action == "Elim" then
		Effects.hitMarker(Color3.fromRGB(255, 60, 60))
		Hud.bigMessage("ELIMINATED", string.upper(a[1]) .. "   •   " .. a[2] .. (a[2] == 1 and " ELIMINATION" or " ELIMINATIONS"), Color3.fromRGB(255, 80, 80), 2.5)
	elseif action == "Placement" then
		S.SpectateName = a[3]
		local by = a[3] ~= "" and ("Eliminated by " .. a[3]) or "Eliminated"
		Hud.endPanel("#" .. a[1], by .. "   •   " .. a[2] .. " eliminations   •   +" .. (C.Coins.Match + a[2] * C.Coins.Kill) .. " coins", WHITE)
	elseif action == "Victory" then
		Hud.endPanel("#1 VICTORY!", a[1] .. " eliminations   •   +" .. (C.Coins.Win + C.Coins.Match + a[1] * C.Coins.Kill) .. " coins", YELLOW)
	elseif action == "Winner" then
		Hud.addFeed("🏆 " .. a[1] .. " won the match!", YELLOW)
	end
end

local function onMode()
	local m = plr:GetAttribute("Mode") or "Menu"
	local prev = S.Mode
	S.Mode = m
	if m ~= prev then
		Core.fade()
	end
	Lobby.Menu.Visible = (m == "Menu")
	Hud.HUD.Visible = (m == "Warmup" or m == "Match")
	UI.MapGroup.Visible = (m ~= "Menu")
	UI.LobbyBtn.Visible = (m == "Warmup")
	S.Building, S.ADS, S.Firing = false, false, false
	Hud.setMapOpen(false)
	if m == "Menu" then
		UI.EndPanel.Visible = false
		S.Overlay = false
		S.SpectateName = ""
		local pad = plr:GetAttribute("PadPos")
		if typeof(pad) == "Vector3" then
			Lobby.buildBackdrop(pad)
		end
		Lobby.Showcase.Parent = workspace
	else
		Lobby.Showcase.Parent = nil
	end
	if m == "Warmup" then
		Hud.bigMessage("WARM UP", "Practice your aim and your building!", WHITE, 3)
	elseif m == "Bus" then
		Hud.bigMessage("ALL ABOARD THE SKY BUS", TOUCH and "Tap JUMP to drop" or "Press SPACE to jump  •  B to thank the driver", WHITE, 4)
	end
	Hud.refreshInv()
end

function Events.start()
	Net.OnClientEvent:Connect(onServer)
	plr:GetAttributeChangedSignal("Mode"):Connect(onMode)
	plr:GetAttributeChangedSignal("PadPos"):Connect(function()
		local pad = plr:GetAttribute("PadPos")
		if S.Mode == "Menu" and typeof(pad) == "Vector3" then
			Lobby.buildBackdrop(pad)
		end
	end)
	onMode()
	plr.CharacterAdded:Connect(function()
		S.GlideSent, S.LandSent = false, false
		S.Firing, S.ADS = false, false
		if S.Mode ~= "Dead" then
			UI.EndPanel.Visible = false
			S.Overlay = false
		end
	end)
end

return Events
