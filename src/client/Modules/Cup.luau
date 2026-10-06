-- Cup: the tournament leaderboard panel on the LOBBY page (top-right, opposite the SQUAD panel).
-- One board for this game and for players elsewhere; the server (CrossSquad.cup) sends it with every
-- name already filtered by Roblox — this only draws it. 🧱 = played here, 🌐 = played elsewhere.

local Core = require(script.Parent.Core)
local Lobby = require(script.Parent.Lobby)
local Net = Core.Net
local new, corner, stroke, text, button = Core.new, Core.corner, Core.stroke, Core.text, Core.button
local WHITE, YELLOW, FONT_H, FONT_B, FONT_M = Core.WHITE, Core.YELLOW, Core.FONT_H, Core.FONT_B, Core.FONT_M

local SOFT = Color3.fromRGB(170, 200, 255)
local NAVY = Color3.fromRGB(10, 20, 60)
local BLUE = Color3.fromRGB(40, 90, 200)
local EDGE = Color3.fromRGB(60, 110, 230)
local FIELD = Color3.fromRGB(20, 34, 90)
local LEFT = Enum.TextXAlignment.Left

local Cup = {}

local page = Lobby.Pages.LOBBY
local view: any = nil
local receivedAt = 0
local tab = "PLAYERS"

local toggle = button(page, "🏆 CUP", UDim2.new(0, 300, 0, 44), UDim2.new(1, -330, 0, 20), NAVY, YELLOW, 24)
stroke(toggle, EDGE, 2)

local panel = new("Frame", { Size = UDim2.new(0, 300, 0, 372), Position = UDim2.new(1, -330, 0, 72), BackgroundColor3 = NAVY, BackgroundTransparency = 0.2, Visible = false }, page)
corner(panel, 8)
stroke(panel, EDGE, 2)
local inner = new("Frame", { Size = UDim2.new(1, -24, 1, -20), Position = UDim2.new(0, 12, 0, 10), BackgroundTransparency = 1 }, panel)

local titleL = text(inner, "TOURNAMENT", UDim2.new(1, 0, 0, 28), UDim2.new(), FONT_H, 22, YELLOW, LEFT)
titleL.TextTruncate = Enum.TextTruncate.AtEnd
local whenL = text(inner, "", UDim2.new(1, 0, 0, 18), UDim2.new(0, 0, 0, 28), FONT_M, 13, SOFT, LEFT)
local youL = text(inner, "", UDim2.new(1, 0, 0, 22), UDim2.new(0, 0, 0, 48), FONT_B, 15, YELLOW, LEFT)
local tabP = button(inner, "PLAYERS", UDim2.new(0.5, -3, 0, 28), UDim2.new(0, 0, 0, 74), BLUE, WHITE, 16)
local tabS = button(inner, "SQUADS", UDim2.new(0.5, -3, 0, 28), UDim2.new(0.5, 3, 0, 74), FIELD, WHITE, 16)
local rows = new("Frame", { Size = UDim2.new(1, 0, 0, 210), Position = UDim2.new(0, 0, 0, 108), BackgroundTransparency = 1 }, inner)
local scoringL = text(inner, "", UDim2.new(1, 0, 0, 32), UDim2.new(0, 0, 1, -32), FONT_M, 11, SOFT, LEFT)
scoringL.TextWrapped = true
scoringL.TextYAlignment = Enum.TextYAlignment.Top

local function fmt(sec: number): string
	sec = math.max(0, math.floor(sec))
	local d, h, m = sec // 86400, (sec % 86400) // 3600, (sec % 3600) // 60
	if d > 0 then
		return string.format("%dd %dh", d, h)
	elseif h > 0 then
		return string.format("%dh %dm", h, m)
	end
	return string.format("%dm", m)
end

local function whenText(): string
	local v = view
	if type(v) ~= "table" then
		return "Loading…"
	elseif v.None then
		return "No tournament right now"
	end
	local gone = os.clock() - receivedAt
	if v.Active then
		return "⏳ " .. fmt((tonumber(v.EndsIn) or 0) - gone) .. " left"
	elseif v.Upcoming then
		return "Starts in " .. fmt((tonumber(v.StartsIn) or 0) - gone)
	end
	return "Finished"
end

local function render()
	local v = view
	rows:ClearAllChildren()
	new("UIListLayout", { Padding = UDim.new(0, 1) }, rows)
	tabP.BackgroundColor3 = tab == "PLAYERS" and BLUE or FIELD
	tabS.BackgroundColor3 = tab == "SQUADS" and BLUE or FIELD
	whenL.Text = whenText()
	if type(v) ~= "table" or v.None then
		titleL.Text = "TOURNAMENT"
		youL.Text = ""
		scoringL.Text = ""
		return
	end
	titleL.Text = string.upper(tostring(v.Name))
	youL.Text = type(v.You) == "table" and string.format("YOU  #%d  •  %d PTS", v.You.Rank, v.You.Score) or ""
	scoringL.Text = tostring(v.Scoring or "")
	local list = tab == "PLAYERS" and (v.Players or {}) or (v.Teams or {})
	if #list == 0 then
		text(rows, tab == "PLAYERS" and "Nobody has scored yet. Be the first!" or "No squad has scored yet.", UDim2.new(1, 0, 0, 22), UDim2.new(), FONT_M, 14, SOFT, LEFT)
		return
	end
	for _, e in list do
		local r = new("Frame", { Size = UDim2.new(1, 0, 0, 20), BackgroundColor3 = Color3.fromRGB(120, 95, 10), BackgroundTransparency = e.You and 0.55 or 1, BorderSizePixel = 0 }, rows)
		corner(r, 4)
		text(r, "#" .. tostring(e.Rank), UDim2.new(0, 34, 1, 0), UDim2.new(), FONT_H, 15, YELLOW, LEFT)
		local label = tab == "PLAYERS" and (tostring(e.Badges or "") .. " " .. tostring(e.Name)) or ((e.Cross and "🌐 " or "") .. tostring(e.Members))
		local n = text(r, label, UDim2.new(1, -84, 1, 0), UDim2.new(0, 34, 0, 0), FONT_B, 14, e.You and YELLOW or WHITE, LEFT)
		n.TextTruncate = Enum.TextTruncate.AtEnd
		text(r, tostring(e.Score), UDim2.new(0, 48, 1, 0), UDim2.new(1, -48, 0, 0), FONT_H, 16, WHITE, Enum.TextXAlignment.Right)
	end
end

toggle.MouseButton1Click:Connect(function()
	panel.Visible = not panel.Visible
	if panel.Visible then
		Net:FireServer("Cup")
	end
end)
tabP.MouseButton1Click:Connect(function()
	tab = "PLAYERS"
	render()
end)
tabS.MouseButton1Click:Connect(function()
	tab = "SQUADS"
	render()
end)

-- while it's open: tick the countdown every second, refresh the board every 20 s
task.spawn(function()
	local since = 0
	while true do
		task.wait(1)
		if panel.Visible and panel:IsDescendantOf(game) then
			whenL.Text = whenText()
			since += 1
			if since >= 20 then
				since = 0
				Net:FireServer("Cup")
			end
		end
	end
end)

-- from the server (Events → "Cup")
function Cup.set(v: any)
	if type(v) ~= "table" then
		return
	end
	view = v
	receivedAt = os.clock()
	render()
end

render()

return Cup
