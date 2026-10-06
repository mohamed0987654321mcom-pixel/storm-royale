-- Squad: the cross-play squad panel on the LOBBY page. Team up with friends: share one code, chat,
-- ready up, and drop at the same time. The server (CrossSquad) does all the talking to the website
-- and sends a view where every name and chat line is already Roblox-filtered — this only draws it.
-- 🧱 = on Roblox, 🌐 = signed in somewhere else (the game never names other sites).

local Core = require(script.Parent.Core)
local Lobby = require(script.Parent.Lobby)
local Net, S = Core.Net, Core.S
local new, corner, stroke, text, button = Core.new, Core.corner, Core.stroke, Core.text, Core.button
local WHITE, YELLOW, FONT_H, FONT_B, FONT_M = Core.WHITE, Core.YELLOW, Core.FONT_H, Core.FONT_B, Core.FONT_M

local SOFT = Color3.fromRGB(170, 200, 255)
local NAVY = Color3.fromRGB(10, 20, 60)
local BLUE = Color3.fromRGB(40, 90, 200)
local EDGE = Color3.fromRGB(60, 110, 230)
local FIELD = Color3.fromRGB(20, 34, 90)
local DARK = Color3.fromRGB(20, 20, 20)

local Squad = {}

local page = Lobby.Pages.LOBBY
local view: any = { InSquad = false }
local lastLaunch = 0

local function send(action: string, arg: any?)
	Net:FireServer("Squad", action, arg)
end

local function field(parent: Instance, placeholder: string, size: UDim2, pos: UDim2, font: Enum.Font, ts: number): TextBox
	local b = new("TextBox", {
		Size = size, Position = pos, BackgroundColor3 = FIELD, TextColor3 = WHITE, Text = "",
		PlaceholderText = placeholder, PlaceholderColor3 = Color3.fromRGB(120, 140, 200),
		Font = font, TextSize = ts, ClearTextOnFocus = false, BorderSizePixel = 0,
	}, parent)
	corner(b, 6)
	return b
end

-- the toggle sits top-left of the lobby, above the PARTY panel
local toggle = button(page, "👥 SQUAD", UDim2.new(0, 300, 0, 44), UDim2.new(0, 30, 0, 20), NAVY, YELLOW, 24)
stroke(toggle, EDGE, 2)

local panel = new("Frame", { Size = UDim2.new(0, 300, 0, 372), Position = UDim2.new(0, 30, 0, 72), BackgroundColor3 = NAVY, BackgroundTransparency = 0.2, Visible = false }, page)
corner(panel, 8)
stroke(panel, EDGE, 2)

-- not in a squad: make one, or join with a code ---------------------------------------
local outView = new("Frame", { Size = UDim2.new(1, -24, 1, -20), Position = UDim2.new(0, 12, 0, 10), BackgroundTransparency = 1 }, panel)
text(outView, "SQUAD", UDim2.new(1, 0, 0, 30), UDim2.new(), FONT_H, 24, YELLOW, Enum.TextXAlignment.Left)
local blurb = text(outView, "Share a code with your friends, chat, ready up and drop at the same time.", UDim2.new(1, 0, 0, 52), UDim2.new(0, 0, 0, 32), FONT_M, 14, SOFT, Enum.TextXAlignment.Left)
blurb.TextWrapped = true
blurb.TextYAlignment = Enum.TextYAlignment.Top
local createBtn = button(outView, "CREATE SQUAD", UDim2.new(1, 0, 0, 46), UDim2.new(0, 0, 0, 92), YELLOW, DARK, 24)
text(outView, "OR JOIN WITH A CODE", UDim2.new(1, 0, 0, 22), UDim2.new(0, 0, 0, 150), FONT_B, 14, SOFT, Enum.TextXAlignment.Left)
local codeBox = field(outView, "CODE", UDim2.new(1, -96, 0, 42), UDim2.new(0, 0, 0, 176), FONT_H, 24)
local joinBtn = button(outView, "JOIN", UDim2.new(0, 88, 0, 42), UDim2.new(1, -88, 0, 176), BLUE, WHITE, 22)

-- in a squad: members, ready / launch, chat -------------------------------------------
local inView = new("Frame", { Size = UDim2.new(1, -24, 1, -20), Position = UDim2.new(0, 12, 0, 10), BackgroundTransparency = 1, Visible = false }, panel)
local codeL = text(inView, "", UDim2.new(1, -80, 0, 30), UDim2.new(), FONT_H, 22, YELLOW, Enum.TextXAlignment.Left)
local leaveBtn = button(inView, "LEAVE", UDim2.new(0, 74, 0, 28), UDim2.new(1, -74, 0, 1), Color3.fromRGB(150, 40, 55), WHITE, 18)
local launchBar = new("Frame", { Size = UDim2.new(1, 0, 0, 26), Position = UDim2.new(0, 0, 0, 34), BackgroundColor3 = Color3.fromRGB(90, 70, 0), Visible = false }, inView)
corner(launchBar, 6)
text(launchBar, "🚀 LAUNCHED! PRESS PLAY", UDim2.fromScale(1, 1), UDim2.new(), FONT_H, 18, YELLOW)
local rows = new("Frame", { Size = UDim2.new(1, 0, 0, 132), Position = UDim2.new(0, 0, 0, 64), BackgroundTransparency = 1 }, inView)
local readyBtn = button(inView, "READY UP", UDim2.new(0.5, -3, 0, 36), UDim2.new(0, 0, 0, 200), BLUE, WHITE, 20)
local launchBtn = button(inView, "🚀 LAUNCH", UDim2.new(0.5, -3, 0, 36), UDim2.new(0.5, 3, 0, 200), YELLOW, DARK, 20)
local chatBox = new("Frame", { Size = UDim2.new(1, 0, 0, 74), Position = UDim2.new(0, 0, 0, 242), BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.6, ClipsDescendants = true }, inView)
corner(chatBox, 6)
local chatIn = field(inView, "Say something…", UDim2.new(1, -74, 0, 30), UDim2.new(0, 0, 0, 322), FONT_M, 14)
chatIn.TextXAlignment = Enum.TextXAlignment.Left
new("UIPadding", { PaddingLeft = UDim.new(0, 8) }, chatIn)
local sendBtn = button(inView, "SEND", UDim2.new(0, 68, 0, 30), UDim2.new(1, -68, 0, 322), BLUE, WHITE, 18)

local function myRow(): any
	for _, m in (view.Members or {}) do
		if m.You then
			return m
		end
	end
	return nil
end

local function render()
	local v = view
	local inSquad = v.InSquad == true
	outView.Visible = not inSquad
	inView.Visible = inSquad
	toggle.Text = inSquad and ("👥 SQUAD  •  " .. #(v.Members or {})) or "👥 SQUAD"
	if not inSquad then
		return
	end
	codeL.Text = "CODE  " .. tostring(v.Code)
	launchBar.Visible = (tonumber(v.Launch) or 0) > 0

	rows:ClearAllChildren()
	new("UIListLayout", { Padding = UDim.new(0, 0) }, rows)
	for _, m in (v.Members or {}) do
		local r = new("Frame", { Size = UDim2.new(1, 0, 0, 22), BackgroundTransparency = 1 }, rows)
		local label = (m.Roblox and "🧱 " or "🌐 ") .. (m.Leader and "👑 " or "") .. tostring(m.Name) .. (m.You and " (you)" or "")
		local n = text(r, label, UDim2.new(0.62, 0, 1, 0), UDim2.new(), FONT_B, 15, m.You and YELLOW or WHITE, Enum.TextXAlignment.Left)
		n.TextTruncate = Enum.TextTruncate.AtEnd
		text(r, (m.Ready and "✅ " or "") .. tostring(m.Status), UDim2.new(0.38, 0, 1, 0), UDim2.new(0.62, 0, 0, 0), FONT_M, 12, SOFT, Enum.TextXAlignment.Right)
	end

	local me = myRow()
	readyBtn.Text = (me and me.Ready) and "NOT READY" or "READY UP"
	launchBtn.Visible = v.Leader == true
	readyBtn.Size = v.Leader and UDim2.new(0.5, -3, 0, 36) or UDim2.new(1, 0, 0, 36)

	chatBox:ClearAllChildren()
	new("UIListLayout", { Padding = UDim.new(0, 1), VerticalAlignment = Enum.VerticalAlignment.Bottom }, chatBox)
	new("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingBottom = UDim.new(0, 3) }, chatBox)
	local lines = v.Chat or {}
	for i = math.max(1, #lines - 3), #lines do
		local c = lines[i]
		local str = c.System and tostring(c.Text) or ((c.Roblox and "" or "🌐 ") .. tostring(c.Name) .. ": " .. tostring(c.Text))
		local l = text(chatBox, str, UDim2.new(1, 0, 0, 17), UDim2.new(), FONT_M, 13, c.System and SOFT or WHITE, Enum.TextXAlignment.Left)
		l.TextTruncate = Enum.TextTruncate.AtEnd
	end
	chatIn.Visible = v.CanChat == true
	sendBtn.Visible = v.CanChat == true
end

-- buttons -----------------------------------------------------------------------------
toggle.MouseButton1Click:Connect(function()
	panel.Visible = not panel.Visible
end)
createBtn.MouseButton1Click:Connect(function()
	send("create")
end)
local function join()
	local code = string.gsub(string.upper(codeBox.Text), "[^%w]", "")
	if #code >= 4 then
		send("join", code)
		codeBox.Text = ""
	end
end
joinBtn.MouseButton1Click:Connect(join)
codeBox.FocusLost:Connect(function(enter)
	if enter then
		join()
	end
end)
leaveBtn.MouseButton1Click:Connect(function()
	send("leave")
end)
readyBtn.MouseButton1Click:Connect(function()
	local me = myRow()
	send("ready", not (me and me.Ready))
end)
launchBtn.MouseButton1Click:Connect(function()
	send("launch")
end)
local function sendChat()
	local msg = string.sub(chatIn.Text, 1, 200)
	if string.match(msg, "%S") then
		send("chat", msg)
		chatIn.Text = ""
	end
end
sendBtn.MouseButton1Click:Connect(sendChat)
chatIn.FocusLost:Connect(function(enter)
	if enter then
		sendChat()
	end
end)

-- from the server (Events → "Squad") ---------------------------------------------------
function Squad.set(v: any)
	if type(v) ~= "table" then
		return
	end
	local was = view.InSquad == true
	view = v
	if v.InSquad == true and not was then
		panel.Visible = true -- just made or joined one: show it
	end
	local launch = tonumber(v.Launch) or 0
	if launch > lastLaunch then
		lastLaunch = launch
		if S.Mode == "Menu" then
			Core.toast("🚀 Your squad launched! Press PLAY to drop in.")
		end
	end
	render()
end

render()

return Squad
