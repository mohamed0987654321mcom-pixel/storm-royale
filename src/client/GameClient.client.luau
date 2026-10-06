-- GameClient (LocalScript) — boots the Storm Royale client. Pieces live in ./Modules:
--   Core       services, shared state, UI + aiming helpers
--   Lobby      menu tabs, locker, item shop, career, stage backdrop
--   Hud        health/shield, hotbar, minimap, feed, crosshair, messages
--   Effects    tracers, muzzle flash, damage numbers, hit markers
--   Weapons    shooting, pickaxe, heals
--   Build      building preview + placement
--   Skydive    bus jump, skydiving, glider, landing
--   Input      keyboard/mouse + touch buttons
--   StormFX    storm wall + purple tint
--   CameraCtl  lobby / shoulder / bus / spectate cameras
--   Events     server messages and screen changes
--   Cursor     the Storm Royale mouse cursor
--   Squad      cross-play squad panel on the lobby page (driven by Events)
--   Cup        tournament leaderboard panel on the lobby page (driven by Events)

local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")

local Modules = script.Parent:WaitForChild("Modules")
local Core = require(Modules.Core)
local Hud = require(Modules.Hud)
local Weapons = require(Modules.Weapons)
local Build = require(Modules.Build)
local Skydive = require(Modules.Skydive)
local Input = require(Modules.Input)
local StormFX = require(Modules.StormFX)
local CameraCtl = require(Modules.CameraCtl)
local Events = require(Modules.Events)
local Cursor = require(Modules.Cursor)
local S, State = Core.S, Core.State

pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Health, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.PlayerList, false)
end)

Input.start()
Events.start()
Cursor.start()

RunService:BindToRenderStep("StormRoyale", Enum.RenderPriority.Camera.Value + 1, function(dt)
	local now = workspace:GetServerTimeNow()
	CameraCtl.update()
	local dropping = Skydive.update()
	if Core.inGame() and not dropping and S.Firing and not S.MapOpen and not S.Overlay then
		if S.Building then
			Build.tryBuild()
		else
			Weapons.shoot()
		end
	end
	Build.updateGhost()
	if S.Mode ~= "Menu" then
		Hud.update(now, dt)
	end
	local phase = State:GetAttribute("Phase")
	local inMatch = S.Mode == "Match" or S.Mode == "Bus" or S.Mode == "Dead"
	StormFX.update(inMatch and (phase == "Bus" or phase == "Playing" or phase == "Ended"), now)
end)
