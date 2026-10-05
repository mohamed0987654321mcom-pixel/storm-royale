-- WebLink: connects the game to the Storm Royale website.
--   • every few seconds: tells the website who's playing (and where), gets back each linked
--     player's website party + recent party chat, and shows it in the lobby
--   • after a match: sends kills / placement so the website profile shows stats
--
-- Setup (once, in Studio — never put the key in the code or on GitHub):
--   1. Game Settings → Security → turn on "Allow HTTP Requests"
--   2. In ServerStorage add a StringValue named "StormRoyaleApiKey" and paste the API key as its Value
--
-- Roblox rules: all player text shown in the game must go through Roblox's text filter, so every
-- chat line is filtered with TextService for each viewer, and party members are shown by their
-- Roblox usernames (already moderated by Roblox). The game never shows the website's address.

local HttpService = game:GetService("HttpService")
local TextService = game:GetService("TextService")
local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

local Core = require(script.Parent.Core)
local Avatar = require(script.Parent.Avatar)
local C, Net = Core.C, Core.Net

local WebLink = {}

local apiKey: string? = nil
local filtered: { [string]: string | false } = {} -- "<msgId>:<viewerId>" -> filtered text (false = hidden)
local robloxNames: { [number]: string } = {}
local linkedNow: { [Player]: boolean } = {} -- linked to a website account (as of the last sync)
local pulling: { [Player]: boolean } = {}

local STATUS = { Menu = "Lobby", Warmup = "Warm-up", Bus = "On the bus", Match = "In match", Dead = "Spectating" }

local function readKey(): string?
	local v = ServerStorage:FindFirstChild("StormRoyaleApiKey")
	if v and v:IsA("StringValue") and #v.Value > 10 then
		return v.Value
	end
	return nil
end

local function post(path: string, body: any): any?
	if not apiKey then
		return nil
	end
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = C.WEB_URL .. path,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json", ["x-api-key"] = apiKey },
			Body = HttpService:JSONEncode(body),
		})
	end)
	if not ok then
		warn("[WebLink] request failed: " .. tostring(res))
		return nil
	end
	if not res.Success then
		warn(("[WebLink] %s -> HTTP %d"):format(path, res.StatusCode))
		return nil
	end
	local okJson, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
	return okJson and data or nil
end

local function robloxName(userId: number?): string?
	if not userId then
		return nil
	end
	if robloxNames[userId] then
		return robloxNames[userId]
	end
	local ok, name = pcall(Players.GetNameFromUserIdAsync, Players, userId)
	if ok and name then
		robloxNames[userId] = name
		return name
	end
	return nil
end

-- filter a website chat line for one viewer; returns nil if it can't be shown
local function filterFor(msg, viewer: Player): string?
	local key = tostring(msg.id) .. ":" .. viewer.UserId
	local cached = filtered[key]
	if cached ~= nil then
		return cached or nil
	end
	local result: string | false = false
	local author = tonumber(msg.robloxId)
	if author and type(msg.text) == "string" then
		local ok, text = pcall(function()
			local r = TextService:FilterStringAsync(msg.text, author, Enum.TextFilterContext.PrivateChat)
			return r:GetChatForUserAsync(viewer.UserId)
		end)
		if ok and type(text) == "string" and text ~= "" then
			result = text
		end
	end
	filtered[key] = result
	return result or nil
end

local function sendToPlayer(plr: Player, info)
	if not info or not info.party then
		Net:FireClient(plr, "WebParty", { Linked = info ~= nil })
		return
	end
	local members = {}
	for _, m in info.party.members do
		local rid = tonumber(m.robloxId)
		table.insert(members, {
			Name = robloxName(rid) or "Party member",
			Status = tostring(m.status or ""),
			Leader = m.leader == true,
			Ready = m.ready == true,
			Here = rid ~= nil and Players:GetPlayerByUserId(rid) ~= nil,
		})
	end
	local chat = {}
	for _, msg in info.chat or {} do
		local text = filterFor(msg, plr)
		if text then
			table.insert(chat, { Name = robloxName(tonumber(msg.robloxId)) or "Party member", Text = text })
		end
	end
	Net:FireClient(plr, "WebParty", { Linked = true, Members = members, Chat = chat })
end

-------------------------------------------------------------------------------
-- MY STYLE looks: the website and the game share one look per player
-------------------------------------------------------------------------------

-- send a look made in the game to the website (nil = back to the normal avatar)
function WebLink.saveLook(plr: Player, look: any?)
	if not apiKey or not linkedNow[plr] then
		return
	end
	-- JSON can't carry a Lua nil, so "back to normal" is sent as reset = true
	local res = post("/api/game/look/save", { robloxId = plr.UserId, look = look or {}, reset = look == nil })
	local d = Core.Data[plr]
	if res and res.ok and d then
		d.WebLookVer = tonumber(res.lookVer)
	end
end

-- the player's owned items, so the website locker can show them too
function WebLink.uploadInventory(plr: Player, items: { any })
	if not apiKey or not linkedNow[plr] then
		return
	end
	local res = post("/api/game/inventory", { robloxId = plr.UserId, items = items })
	if res and res.ok then
		Core.toast(plr, "🎨 Your items are on the website locker too!")
	end
end

-- a look saved on the website: fetch it and wear it (ownership is checked again when it's worn)
local function pullLook(plr: Player, ver: number)
	if pulling[plr] then
		return
	end
	pulling[plr] = true
	local res = post("/api/game/look", { robloxId = plr.UserId })
	local d = Core.Data[plr]
	if res and res.ok and d and plr.Parent then
		d.WebLookVer = tonumber(res.lookVer) or ver
		if type(res.look) == "table" then
			Avatar.setLook(plr, Avatar.sanitize(res.look))
			Core.toast(plr, "✨ Your look from the website is on!")
		else
			Avatar.setLook(plr, nil)
		end
	end
	pulling[plr] = nil
end

local function syncLook(plr: Player, info: any)
	local d = Core.Data[plr]
	if not d or not info then
		return
	end
	local ver = tonumber(info.lookVer) or 0
	if ver > 0 and ver ~= d.WebLookVer then
		task.spawn(pullLook, plr, ver)
	elseif ver == 0 and type(d.Look) == "table" and d.WebLookVer == nil then
		-- made a look in the game before linking: share it with the website
		d.WebLookVer = 0
		task.spawn(WebLink.saveLook, plr, d.Look)
	end
end

local function syncOnce()
	local list = {}
	for _, p in Players:GetPlayers() do
		table.insert(list, { robloxId = p.UserId, status = STATUS[p:GetAttribute("Mode") or "Menu"] or "Lobby" })
	end
	if #list == 0 then
		return
	end
	local data = post("/api/game/sync", { players = list })
	if not data or type(data.players) ~= "table" then
		return
	end
	for _, p in Players:GetPlayers() do
		local info = data.players[tostring(p.UserId)]
		linkedNow[p] = info ~= nil
		task.spawn(sendToPlayer, p, info)
		syncLook(p, info)
	end
end

Players.PlayerRemoving:Connect(function(plr)
	linkedNow[plr] = nil
	pulling[plr] = nil
end)

-- called when a player's match ends (eliminated or won)
function WebLink.reportMatch(plr: Player, kills: number, placement: number, won: boolean)
	if not apiKey then
		return
	end
	task.spawn(post, "/api/game/match", { robloxId = plr.UserId, kills = kills, placement = placement, won = won })
end

function WebLink.start()
	apiKey = readKey()
	if not apiKey then
		warn("[WebLink] No API key (ServerStorage.StormRoyaleApiKey). Website parties are off.")
		return
	end
	task.spawn(function()
		local lastClear = os.clock()
		while true do
			local ok, err = pcall(syncOnce)
			if not ok then
				warn("[WebLink] sync error: " .. tostring(err))
			end
			if os.clock() - lastClear > 600 then
				table.clear(filtered)
				lastClear = os.clock()
			end
			task.wait(C.WEB_SYNC)
		end
	end)
end

return WebLink
