-- Core: services, remotes, shared state and small helpers used by every server module

local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")

local C = require(RS:WaitForChild("Shared"):WaitForChild("BRConfig"))

local Core = {}
Core.C = C

local Net = Instance.new("RemoteEvent")
Net.Name = "BRNet"
Net.Parent = RS
Core.Net = Net

local State = Instance.new("Folder")
State.Name = "BRState"
State:SetAttribute("Phase", "Waiting")
State:SetAttribute("Countdown", 0)
State:SetAttribute("Alive", 0)
State:SetAttribute("Ready", 0)
State.Parent = RS
Core.State = State

local function folder(name: string): Folder
	local f = workspace:FindFirstChild(name)
	if f then
		f:Destroy()
	end
	local nf = Instance.new("Folder")
	nf.Name = name
	nf.Parent = workspace
	return nf
end
Core.MapF = folder("BR_Map")
Core.BuildF = folder("BR_Builds")
Core.LootF = folder("BR_Loot")
Core.BotF = folder("BR_Bots")
Core.FxF = folder("BR_Effects")
Core.MenuF = folder("BR_Menu")

-- [Player | bot Model] = owner table (inventory, kills, last attacker, ...)
Core.Owners = {} :: { [any]: any }
-- [Player] = saved data (coins, stats, cosmetics)
Core.Data = {} :: { [Player]: any }
-- current match
Core.Match = { Id = 0, Alive = {} :: { [any]: boolean }, Bus = nil :: Model?, BusCF = CFrame.new(), DoorsOpen = false }

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------
function Core.P(parent: Instance?, size: Vector3, cf: CFrame, color: Color3, mat: Enum.Material?, anchored: boolean?, class: string?): BasePart
	local p = Instance.new(class or "Part") :: BasePart
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = mat or Enum.Material.SmoothPlastic
	p.Anchored = if anchored == nil then true else anchored
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

function Core.weld(a: BasePart, b: BasePart, c0: CFrame)
	local w = Instance.new("Weld")
	w.Part0 = a
	w.Part1 = b
	w.C0 = c0
	w.Parent = b
end

local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Include
groundParams.FilterDescendantsInstances = { workspace.Terrain }
function Core.groundY(x: number, z: number): number
	local r = workspace:Raycast(Vector3.new(x, 800, z), Vector3.new(0, -1600, 0), groundParams)
	return r and r.Position.Y or 0
end

function Core.toast(plr: Player?, text: string)
	if plr then
		Net:FireClient(plr, "Toast", text)
	end
end

-------------------------------------------------------------------------------
-- Owners (players + bots)
-------------------------------------------------------------------------------
function Core.getChar(o): Model?
	if o.IsBot then
		return o.Model
	end
	return o.Player.Character
end

function Core.getMode(o): string
	if o.IsBot then
		return "Match"
	end
	return o.Player:GetAttribute("Mode") or "Menu"
end

function Core.aliveHum(o): Humanoid?
	local ch = Core.getChar(o)
	local h = ch and ch:FindFirstChildOfClass("Humanoid")
	if h and h.Health > 0 then
		return h
	end
	return nil
end

function Core.aliveCount(): number
	local n = 0
	for _ in Core.Match.Alive do
		n += 1
	end
	return n
end

function Core.playerAlive(): boolean
	for o in Core.Match.Alive do
		if not o.IsBot then
			return true
		end
	end
	return false
end

function Core.updateAlive()
	State:SetAttribute("Alive", Core.aliveCount())
end

-------------------------------------------------------------------------------
-- Saved data (needs "Enable Studio Access to API Services" to save in Studio)
-------------------------------------------------------------------------------
local store
pcall(function()
	store = DataStoreService:GetDataStore("StormRoyale_v1")
end)

function Core.pushData(plr: Player)
	if Core.Data[plr] then
		plr:SetAttribute("Data", HttpService:JSONEncode(Core.Data[plr]))
	end
end

function Core.loadData(plr: Player)
	local d = { Coins = 200, Wins = 0, Kills = 0, Matches = 0, Owned = {}, Outfit = "Default", Glider = "Classic" }
	if store then
		local ok, saved = pcall(function()
			return store:GetAsync("u" .. plr.UserId)
		end)
		if ok and type(saved) == "table" then
			for k, v in saved do
				d[k] = v
			end
		end
	end
	for _, o in C.Outfits do
		if o.Price == 0 then
			d.Owned[o.Id] = true
		end
	end
	for _, g in C.Gliders do
		if g.Price == 0 then
			d.Owned[g.Id] = true
		end
	end
	Core.Data[plr] = d
	Core.pushData(plr)
end

function Core.saveData(plr: Player)
	if store and Core.Data[plr] then
		pcall(function()
			store:SetAsync("u" .. plr.UserId, Core.Data[plr])
		end)
	end
end

function Core.addStat(plr: Player?, key: string, n: number)
	if plr and Core.Data[plr] then
		Core.Data[plr][key] = (Core.Data[plr][key] or 0) + n
		Core.pushData(plr)
	end
end

Core.Players = Players

return Core
