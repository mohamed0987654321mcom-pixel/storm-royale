-- CrossSquad: cross-play squads. A Roblox player teams up with friends who are signed in somewhere
-- else (one squad: a join code, squad chat, ready-up, a synced launch, and everyone's results).
-- The website hosts the squad (web/lib/crossplay.js); this module talks to it with WebLink's
-- authenticated requests (same API key — nothing new to set up), refreshes it every few seconds
-- while the player is in a squad, and sends the client a view that's ready to draw.
--
-- Roblox rules (the same ones WebLink follows):
--   • every bit of player text shown in-game goes through TextService, filtered for each viewer;
--     anything that can't be filtered is hidden
--   • Roblox players are shown by their Roblox usernames; everyone else's name is filtered too
--   • the game never names or points to other sites: members elsewhere just show as 🌐 / "Online"
--   • players Roblox doesn't let chat can still squad up, but can't send squad chat; what they do
--     send is filtered by Roblox before it ever leaves the game
--
-- Client requests arrive through Remotes ("Squad", action, arg); the view goes back as Net "Squad".
--
-- Also the TOURNAMENT board (Remotes "Cup" → Net "Cup"): the website keeps one leaderboard for the
-- game and for players elsewhere. Every name on it (and an admin-typed event name) is filtered with
-- Roblox's strictest broadcast filter before it's shown; players elsewhere just show as 🌐.

local Players = game:GetService("Players")
local TextService = game:GetService("TextService")
local TextChatService = game:GetService("TextChatService")

local Core = require(script.Parent.Core)
local WebLink = require(script.Parent.WebLink)
local Net = Core.Net

local CrossSquad = {}

local POLL = 4 -- seconds between refreshes while in a squad
local CHAT_LINES = 8
local STATUS = { Menu = "Lobby", Warmup = "Warm-up", Bus = "On the bus", Match = "In match", Dead = "Spectating" }
local KNOWN_STATUS = { Lobby = true, ["Warm-up"] = true, ["On the bus"] = true, ["In match"] = true, Spectating = true }
local ACTIONS = { create = true, join = true, leave = true, ready = true, launch = true, chat = true }

local inSquad: { [Player]: boolean } = {}
local refreshing: { [Player]: boolean } = {}
local lastAction: { [Player]: number } = {}
local canChat: { [Player]: boolean } = {}
local filtered: { [string]: string | false } = {} -- "<key>:<viewerId>" -> filtered text (false = hidden)
local boardNames: { [string]: string | false } = {} -- raw name -> broadcast-filtered (false = hidden)
local lastCup: { [Player]: number } = {}

-------------------------------------------------------------------------------
-- Roblox text rules
-------------------------------------------------------------------------------

local function chatAllowed(plr: Player): boolean
	local c = canChat[plr]
	if c ~= nil then
		return c
	end
	local ok, res = pcall(function()
		return TextChatService:CanUserChatAsync(plr.UserId)
	end)
	if not ok then
		return false -- not cached: ask again next time
	end
	canChat[plr] = res == true
	return res == true
end

local function filterOnce(text: string, author: number, viewer: Player): string?
	local ok, res = pcall(function()
		local r = TextService:FilterStringAsync(text, author, Enum.TextFilterContext.PrivateChat)
		return r:GetChatForUserAsync(viewer.UserId)
	end)
	if ok and type(res) == "string" then
		return res
	end
	return nil
end

-- Text from the squad, filtered for one viewer. `author` is the Roblox user who wrote it when we
-- know one; for people who aren't on Roblox the viewer's own id is used, so the text still gets
-- the strictest filtering that applies to that viewer.
local function filterFor(cacheKey: string, text: string, author: number, viewer: Player): string?
	local key = cacheKey .. ":" .. viewer.UserId
	local hit = filtered[key]
	if hit ~= nil then
		return hit or nil
	end
	local res = filterOnce(text, author, viewer)
	if res == nil and author ~= viewer.UserId then
		res = filterOnce(text, viewer.UserId, viewer) -- e.g. the author isn't in this server
	end
	if res == nil then
		return nil -- couldn't filter right now: hidden, and tried again on the next refresh
	end
	filtered[key] = res ~= "" and res or false
	return res ~= "" and res or nil
end

local function surfaceOf(key: any): string
	return type(key) == "string" and string.match(key, "^(%a+):") or ""
end

local function robloxIdOf(key: any): number?
	if type(key) ~= "string" then
		return nil
	end
	return tonumber(string.match(key, "^roblox:(%d+)$"))
end

local function displayName(key: any, raw: any, viewer: Player): string
	local rid = robloxIdOf(key)
	if rid then
		return WebLink.robloxName(rid) or "Roblox player"
	end
	if type(raw) ~= "string" or raw == "" then
		return "Squad member"
	end
	return filterFor("n:" .. tostring(key) .. ":" .. raw, raw, viewer.UserId, viewer) or "Squad member"
end

-- A Roblox member's status comes from our own game; anyone else just shows as "Online" (their
-- status text could name another site, and the game never does that).
local function statusText(m: any): string
	local r = m.result
	if type(r) == "table" then
		if r.won == true then
			return "🏆 Won"
		end
		return "#" .. tostring(tonumber(r.placement) or "?")
	end
	if surfaceOf(m.key) == "roblox" and KNOWN_STATUS[m.status] then
		return m.status
	end
	return "Online"
end

-------------------------------------------------------------------------------
-- view for the client
-------------------------------------------------------------------------------

local function buildView(plr: Player, v: any): { [string]: any }
	if type(v) ~= "table" or v.inSquad ~= true then
		return { InSquad = false, CanChat = chatAllowed(plr) }
	end
	local members = {}
	for _, m in (type(v.members) == "table" and v.members or {}) do
		if type(m) == "table" then
			table.insert(members, {
				Name = displayName(m.key, m.name, plr),
				Roblox = surfaceOf(m.key) == "roblox",
				Status = statusText(m),
				Ready = m.ready == true,
				Leader = m.leader == true,
				You = m.isYou == true,
			})
		end
	end
	local chat = {}
	local lines = type(v.chat) == "table" and v.chat or {}
	for i = math.max(1, #lines - CHAT_LINES + 1), #lines do
		local c = lines[i]
		if type(c) ~= "table" then
			continue
		end
		if c.system then
			-- rebuilt from a filtered name, never the raw sentence
			local who = displayName(c.whoKey, c.who, plr)
			local text = (c.event == "join" and who .. " joined the squad")
				or (c.event == "leave" and who .. " left the squad")
				or (c.event == "launch" and "🚀 " .. who .. " launched the squad!")
				or nil
			if text then
				table.insert(chat, { System = true, Text = text })
			end
		elseif type(c.text) == "string" and type(c.id) == "string" then
			local text = filterFor("m:" .. c.id, c.text, robloxIdOf(c.key) or plr.UserId, plr)
			if text then
				table.insert(chat, { Name = displayName(c.key, c.name, plr), Roblox = surfaceOf(c.key) == "roblox", Text = text })
			end
		end
	end
	return {
		InSquad = true,
		Code = string.match(tostring(v.code or ""), "^%w+$") or "",
		Leader = v.isLeader == true,
		Members = members,
		Chat = chat,
		Launch = type(v.launch) == "table" and (tonumber(v.launch.at) or 0) or 0,
		CanChat = chatAllowed(plr),
	}
end

local function push(plr: Player, v: any)
	if not plr.Parent then
		return
	end
	local view = buildView(plr, v)
	inSquad[plr] = view.InSquad == true or nil
	Net:FireClient(plr, "Squad", view)
end

local function body(plr: Player): { [string]: any }
	return { robloxId = plr.UserId, name = plr.Name, status = STATUS[plr:GetAttribute("Mode") or "Menu"] or "Lobby" }
end

local function refresh(plr: Player)
	if refreshing[plr] or not plr.Parent then
		return
	end
	refreshing[plr] = true
	local data = WebLink.request("/api/game/crossplay/state", body(plr))
	if data then
		push(plr, data)
	end
	refreshing[plr] = nil
end

-------------------------------------------------------------------------------
-- requests from the client
-------------------------------------------------------------------------------

function CrossSquad.action(plr: Player, action: any, arg: any)
	if type(action) ~= "string" or not ACTIONS[action] then
		return
	end
	if not WebLink.enabled() then
		Core.toast(plr, "Squads aren't available in this server right now.")
		return
	end
	local now = os.clock()
	if now - (lastAction[plr] or -1e9) < 0.5 then
		return
	end
	lastAction[plr] = now

	local b = body(plr)
	if action == "join" then
		local code = string.gsub(string.upper(tostring(arg or "")), "[^%w]", "")
		if #code < 4 or #code > 8 then
			Core.toast(plr, "Enter the squad code.")
			return
		end
		b.code = code
	elseif action == "ready" then
		b.ready = arg == true
	elseif action == "chat" then
		if not chatAllowed(plr) then
			Core.toast(plr, "Chat is off for your account.")
			return
		end
		local raw = string.sub(string.gsub(tostring(arg or ""), "^%s+", ""), 1, 200)
		if raw == "" then
			return
		end
		-- filtered by Roblox (broadcast level, the strictest) before it leaves the game
		local ok, safe = pcall(function()
			local r = TextService:FilterStringAsync(raw, plr.UserId, Enum.TextFilterContext.PublicChat)
			return r:GetNonChatStringForBroadcastAsync()
		end)
		if not ok or type(safe) ~= "string" or safe == "" then
			Core.toast(plr, "Couldn't send that. Try again.")
			return
		end
		b.text = safe
	end

	local data, err = WebLink.request("/api/game/crossplay/" .. action, b)
	if err then
		local msg = err
		if err == "offline" or err == "unavailable" then
			msg = "Squads aren't reachable right now. Try again soon."
		elseif action == "chat" and err ~= "Slow down a little!" then
			msg = "That message wasn't sent." -- don't echo a moderation reason back into the game
		end
		Core.toast(plr, msg)
		return
	end
	if action == "leave" then
		push(plr, { inSquad = false })
		return
	end
	if type(data) == "table" then
		push(plr, data.squad or data)
		if action == "create" and type(data.code) == "string" then
			Core.toast(plr, "Squad created! Code: " .. (string.match(data.code, "^%w+$") or ""))
		end
	end
end

-------------------------------------------------------------------------------
-- tournament board
-------------------------------------------------------------------------------

-- Leaderboard text is the same for everyone, so it gets Roblox's broadcast filter (the strictest)
-- once per name and is cached; the asking player stands in as the author for text from elsewhere.
local function boardSafe(raw: any, author: number): string?
	if type(raw) ~= "string" or raw == "" then
		return nil
	end
	local hit = boardNames[raw]
	if hit ~= nil then
		return hit or nil
	end
	local ok, res = pcall(function()
		local r = TextService:FilterStringAsync(raw, author, Enum.TextFilterContext.PublicChat)
		return r:GetNonChatStringForBroadcastAsync()
	end)
	if not ok or type(res) ~= "string" then
		return nil -- couldn't filter right now: try again next time
	end
	boardNames[raw] = res ~= "" and res or false
	return res ~= "" and res or nil
end

local function badges(surfaces: any): string
	local roblox, other = false, false
	for _, s in (type(surfaces) == "table" and surfaces or {}) do
		if s == "roblox" then
			roblox = true
		else
			other = true
		end
	end
	return (roblox and "🧱" or "") .. (other and "🌐" or "")
end

function CrossSquad.cup(plr: Player)
	if not WebLink.enabled() then
		return
	end
	local now = os.clock()
	if now - (lastCup[plr] or -1e9) < 8 then
		return
	end
	lastCup[plr] = now
	local data = WebLink.request("/api/game/tournament", { robloxId = plr.UserId })
	local b = type(data) == "table" and data.board or nil
	if type(b) ~= "table" or type(b.tournament) ~= "table" then
		Net:FireClient(plr, "Cup", { None = true })
		return
	end
	local me = plr.UserId
	local players = {}
	for i, p in (type(b.players) == "table" and b.players or {}) do
		if i > 10 then
			break
		end
		if type(p) == "table" then
			table.insert(players, { Rank = tonumber(p.rank) or i, Name = boardSafe(p.name, me) or "Player", Score = tonumber(p.score) or 0, Badges = badges(p.surfaces), You = p.you == true })
		end
	end
	local teams = {}
	for i, x in (type(b.teams) == "table" and b.teams or {}) do
		if i > 5 then
			break
		end
		if type(x) == "table" then
			local names = {}
			for _, n in (type(x.members) == "table" and x.members or {}) do
				table.insert(names, boardSafe(n, me) or "Player")
			end
			table.insert(teams, { Rank = tonumber(x.rank) or i, Members = table.concat(names, " + "), Score = tonumber(x.score) or 0, Cross = x.crossPlatform == true, You = x.you == true })
		end
	end
	local t = b.tournament
	local you = nil
	if type(b.you) == "table" then
		you = { Rank = tonumber(b.you.rank) or 0, Score = tonumber(b.you.score) or 0, Matches = tonumber(b.you.matches) or 0 }
	end
	Net:FireClient(plr, "Cup", {
		Name = boardSafe(t.name, me) or "Tournament",
		Active = t.active == true,
		Upcoming = t.upcoming == true,
		EndsIn = math.floor((tonumber(t.endsInMs) or 0) / 1000),
		StartsIn = math.floor((tonumber(t.startsInMs) or 0) / 1000),
		Scoring = type(b.scoring) == "table" and type(b.scoring.text) == "string" and b.scoring.text or "",
		TotalPlayers = tonumber(b.totalPlayers) or #players,
		Players = players,
		Teams = teams,
		You = you,
	})
end

-------------------------------------------------------------------------------

function CrossSquad.start()
	if not WebLink.enabled() then
		return -- WebLink already warned that there's no API key
	end
	task.spawn(function()
		local lastClear = os.clock()
		while true do
			task.wait(POLL)
			for plr in inSquad do
				task.spawn(refresh, plr)
			end
			if os.clock() - lastClear > 600 then
				table.clear(filtered)
				table.clear(boardNames)
				lastClear = os.clock()
			end
		end
	end)
	-- someone who just rejoined may still be in their squad: pick it back up
	Players.PlayerAdded:Connect(function(plr)
		task.delay(3, refresh, plr)
	end)
	for _, plr in Players:GetPlayers() do
		task.spawn(refresh, plr)
	end
end

Players.PlayerRemoving:Connect(function(plr)
	local was = inSquad[plr]
	inSquad[plr], refreshing[plr], lastAction[plr], canChat[plr], lastCup[plr] = nil, nil, nil, nil, nil
	if was then
		task.spawn(WebLink.request, "/api/game/crossplay/leave", { robloxId = plr.UserId })
	end
end)

return CrossSquad
