-- Lobby: the menu screen (LOBBY / LOCKER / ITEM SHOP / CAREER) and the stage backdrop

local HttpService = game:GetService("HttpService")

local Core = require(script.Parent.Core)
local C, Net, S, plr = Core.C, Core.Net, Core.S, Core.plr
local new, corner, stroke, text, button, gradient = Core.new, Core.corner, Core.stroke, Core.text, Core.button, Core.gradient
local WHITE, YELLOW, FONT_H, FONT_B, FONT_M = Core.WHITE, Core.YELLOW, Core.FONT_H, Core.FONT_B, Core.FONT_M
local rarityColor = Core.rarityColor

local Lobby = {}

local Menu = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1 }, Core.gui)
Lobby.Menu = Menu

local topBar = new("Frame", { Size = UDim2.new(1, 0, 0, 66), BackgroundColor3 = Color3.fromRGB(8, 18, 60), BackgroundTransparency = 0.15, BorderSizePixel = 0 }, Menu)
gradient(topBar, Color3.fromRGB(20, 40, 120), Color3.fromRGB(8, 12, 40), 90)
text(topBar, "STORM ROYALE", UDim2.new(0, 260, 1, 0), UDim2.new(0, 20, 0, 0), FONT_H, 32, YELLOW, Enum.TextXAlignment.Left)
local tabHolder = new("Frame", { Size = UDim2.new(0, 640, 1, 0), Position = UDim2.new(0, 290, 0, 0), BackgroundTransparency = 1 }, topBar)
new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 6), VerticalAlignment = Enum.VerticalAlignment.Center }, tabHolder)
local coinL = text(topBar, "🪙 0", UDim2.new(0, 200, 1, 0), UDim2.new(1, -220, 0, 0), FONT_H, 26, WHITE, Enum.TextXAlignment.Right)

local Pages = {}
local TabButtons = {}
local function showTab(name: string)
	for n, p in Pages do
		p.Visible = (n == name)
	end
	for n, b in TabButtons do
		b.TextColor3 = (n == name) and YELLOW or Color3.fromRGB(200, 210, 255)
		b.Underline.Visible = (n == name)
	end
end
for _, name in { "LOBBY", "LOCKER", "ITEM SHOP", "CAREER" } do
	local b = new("TextButton", { Text = name, Size = UDim2.new(0, 145, 0, 46), BackgroundTransparency = 1, Font = FONT_H, TextSize = 24, TextColor3 = WHITE }, tabHolder)
	new("Frame", { Name = "Underline", Size = UDim2.new(0.8, 0, 0, 4), Position = UDim2.new(0.1, 0, 1, -4), BackgroundColor3 = YELLOW, BorderSizePixel = 0 }, b)
	b.MouseButton1Click:Connect(function()
		showTab(name)
	end)
	TabButtons[name] = b
	Pages[name] = new("Frame", { Size = UDim2.new(1, 0, 1, -66), Position = UDim2.new(0, 0, 0, 66), BackgroundTransparency = 1, Visible = false }, Menu)
end

-- LOBBY page: name plate, mode card and the big PLAY button
local plateStats
do
	local pg = Pages.LOBBY
	local plate = new("Frame", { Size = UDim2.new(0, 300, 0, 70), Position = UDim2.new(0, 30, 1, -100), BackgroundColor3 = Color3.fromRGB(10, 20, 60), BackgroundTransparency = 0.3 }, pg)
	corner(plate, 6)
	text(plate, plr.DisplayName, UDim2.new(1, -20, 0, 36), UDim2.new(0, 14, 0, 4), FONT_H, 26, WHITE, Enum.TextXAlignment.Left)
	plateStats = text(plate, "", UDim2.new(1, -20, 0, 24), UDim2.new(0, 14, 0, 40), FONT_M, 15, Color3.fromRGB(180, 200, 255), Enum.TextXAlignment.Left)
	local mode = new("Frame", { Size = UDim2.new(0, 330, 0, 70), Position = UDim2.new(1, -360, 1, -230), BackgroundColor3 = Color3.fromRGB(15, 30, 90), BackgroundTransparency = 0.1 }, pg)
	corner(mode, 6)
	gradient(mode, Color3.fromRGB(40, 90, 200), Color3.fromRGB(15, 30, 90), 0)
	text(mode, "BATTLE ROYALE", UDim2.new(1, -20, 0, 34), UDim2.new(0, 14, 0, 4), FONT_H, 28, WHITE, Enum.TextXAlignment.Left)
	text(mode, "SOLO  •  BUILD  •  " .. C.TOTAL_PLAYERS .. " PLAYERS", UDim2.new(1, -20, 0, 22), UDim2.new(0, 14, 0, 40), FONT_M, 15, Color3.fromRGB(200, 220, 255), Enum.TextXAlignment.Left)
	local play = button(pg, "PLAY", UDim2.new(0, 330, 0, 110), UDim2.new(1, -360, 1, -150), YELLOW, Color3.fromRGB(20, 20, 20), 64)
	gradient(play, Color3.fromRGB(255, 240, 90), Color3.fromRGB(255, 190, 20), 90)
	stroke(play, Color3.fromRGB(120, 80, 0), 3)
	play.MouseButton1Click:Connect(function()
		play.Text = "JOINING..."
		Net:FireServer("Play")
		task.delay(2, function()
			play.Text = "PLAY"
		end)
	end)
	local hint = text(pg, "Press PLAY to drop into the warm-up island. The Sky Bus launches when the countdown ends.", UDim2.new(0, 420, 0, 40), UDim2.new(1, -450, 1, -275), FONT_M, 14, Color3.fromRGB(220, 230, 255), Enum.TextXAlignment.Right)
	hint.TextWrapped = true
end

local function card(parent: Instance, def, owned: boolean, equipped: boolean, onClick: () -> ())
	local b = new("TextButton", { Text = "", Size = UDim2.new(0, 140, 0, 175), BackgroundColor3 = rarityColor(def.Rarity), AutoButtonColor = true, BorderSizePixel = 0 }, parent)
	corner(b, 6)
	gradient(b, rarityColor(def.Rarity), Color3.fromRGB(15, 15, 30), 90)
	if equipped then
		stroke(b, YELLOW, 4)
	end
	local sw = new("Frame", { Size = UDim2.new(0, 70, 0, 70), Position = UDim2.new(0.5, -35, 0, 18), BackgroundColor3 = (def.Colors and def.Colors[2]) or def.Color or Color3.fromRGB(90, 90, 110) }, b)
	corner(sw, 35)
	stroke(sw, (def.Colors and def.Colors[3]) or def.Trim or WHITE, 4)
	text(b, def.Name, UDim2.new(1, -8, 0, 40), UDim2.new(0, 4, 0, 94), FONT_H, 18, WHITE).TextWrapped = true
	local sub = equipped and "EQUIPPED" or (owned and "OWNED" or ("🪙 " .. def.Price))
	text(b, sub, UDim2.new(1, 0, 0, 26), UDim2.new(0, 0, 1, -32), FONT_B, 16, owned and Color3.fromRGB(200, 255, 200) or YELLOW)
	b.MouseButton1Click:Connect(onClick)
	return b
end

local function grid(parent: Instance, title: string, y: number): any
	text(parent, title, UDim2.new(0, 400, 0, 30), UDim2.new(0, 0, 0, y), FONT_H, 26, WHITE, Enum.TextXAlignment.Left)
	local g = new("Frame", { Size = UDim2.new(1, 0, 0, 180), Position = UDim2.new(0, 0, 0, y + 34), BackgroundTransparency = 1 }, parent)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 10) }, g)
	return g
end

local function scroller(page: Instance): any
	return new("ScrollingFrame", { Size = UDim2.new(0, 640, 1, -40), Position = UDim2.new(1, -670, 0, 20), BackgroundTransparency = 1, BorderSizePixel = 0, CanvasSize = UDim2.new(0, 960, 0, 470), ScrollBarThickness = 6 }, page)
end
local LockerBox = scroller(Pages.LOCKER)
local ShopBox = scroller(Pages["ITEM SHOP"])
local CareerBox = new("Frame", { Size = UDim2.new(0, 560, 0, 300), Position = UDim2.new(1, -590, 0, 30), BackgroundTransparency = 1 }, Pages.CAREER)

local function rebuildMenus()
	local d = S.Data
	if not d then
		return
	end
	coinL.Text = "🪙 " .. tostring(d.Coins)
	plateStats.Text = string.format("WINS %d   •   ELIMS %d   •   MATCHES %d", d.Wins or 0, d.Kills or 0, d.Matches or 0)
	LockerBox:ClearAllChildren()
	ShopBox:ClearAllChildren()
	CareerBox:ClearAllChildren()
	local lo = grid(LockerBox, "OUTFIT", 0)
	local lg = grid(LockerBox, "GLIDER", 230)
	local so = grid(ShopBox, "FEATURED OUTFITS", 0)
	local sg = grid(ShopBox, "GLIDERS", 230)
	local function add(def, kind: string, lockParent: Instance, shopParent: Instance)
		local owned = d.Owned[def.Id] == true
		if owned then
			card(lockParent, def, true, d[kind] == def.Id, function()
				Net:FireServer("Cosmetic", def.Id)
			end)
		end
		if def.Price > 0 then
			card(shopParent, def, owned, false, function()
				if not owned then
					Net:FireServer("Buy", def.Id)
				end
			end)
		end
	end
	for _, o in C.Outfits do
		add(o, "Outfit", lo, so)
	end
	for _, g in C.Gliders do
		add(g, "Glider", lg, sg)
	end
	new("UIGridLayout", { CellSize = UDim2.new(0, 170, 0, 120), CellPadding = UDim2.new(0, 14, 0, 14) }, CareerBox)
	local wins, matches = d.Wins or 0, d.Matches or 0
	for _, st in {
		{ "WINS", wins },
		{ "ELIMINATIONS", d.Kills or 0 },
		{ "MATCHES", matches },
		{ "WIN RATE", (matches > 0 and math.floor(wins / matches * 100) or 0) .. "%" },
		{ "COINS", d.Coins or 0 },
	} do
		local f = new("Frame", { BackgroundColor3 = Color3.fromRGB(15, 30, 90), BackgroundTransparency = 0.15 }, CareerBox)
		corner(f, 6)
		gradient(f, Color3.fromRGB(40, 80, 190), Color3.fromRGB(15, 25, 70), 90)
		text(f, tostring(st[2]), UDim2.new(1, 0, 0, 60), UDim2.new(0, 0, 0, 14), FONT_H, 44, YELLOW)
		text(f, st[1], UDim2.new(1, 0, 0, 30), UDim2.new(0, 0, 0, 76), FONT_B, 16, WHITE)
	end
end

local function onData()
	local raw = plr:GetAttribute("Data")
	if type(raw) == "string" then
		local ok, d = pcall(HttpService.JSONDecode, HttpService, raw)
		if ok then
			S.Data = d
			rebuildMenus()
		end
	end
end
plr:GetAttributeChangedSignal("Data"):Connect(onData)
onData()
showTab("LOBBY")

-- PARTY panel (filled by the server's WebLink when this player is in a party)
local partyBox = new("Frame", { Size = UDim2.new(0, 300, 0, 250), Position = UDim2.new(0, 30, 1, -370), BackgroundColor3 = Color3.fromRGB(10, 20, 60), BackgroundTransparency = 0.25, Visible = false }, Pages.LOBBY)
corner(partyBox, 8)
stroke(partyBox, Color3.fromRGB(60, 110, 230), 2)
text(partyBox, "PARTY", UDim2.new(1, -20, 0, 30), UDim2.new(0, 12, 0, 6), FONT_H, 24, YELLOW, Enum.TextXAlignment.Left)
local partyRows = new("Frame", { Size = UDim2.new(1, -24, 0, 104), Position = UDim2.new(0, 12, 0, 38), BackgroundTransparency = 1 }, partyBox)
new("UIListLayout", { Padding = UDim.new(0, 2) }, partyRows)
local partyChat = new("Frame", { Size = UDim2.new(1, -24, 0, 98), Position = UDim2.new(0, 12, 0, 146), BackgroundColor3 = Color3.fromRGB(0, 0, 0), BackgroundTransparency = 0.6, ClipsDescendants = true }, partyBox)
corner(partyChat, 6)
new("UIListLayout", { Padding = UDim.new(0, 1), VerticalAlignment = Enum.VerticalAlignment.Bottom }, partyChat)
new("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingBottom = UDim.new(0, 4) }, partyChat)

function Lobby.setWebParty(data)
	-- not linked: show nothing (the game never points players to other sites)
	if type(data) ~= "table" or data.Linked ~= true then
		partyBox.Visible = false
		return
	end
	partyBox.Visible = true
	partyRows:ClearAllChildren()
	new("UIListLayout", { Padding = UDim.new(0, 2) }, partyRows)
	local members = data.Members
	if type(members) ~= "table" or #members == 0 then
		-- linked, but not in a party right now: a small card so it's clear the link works
		partyBox.Size = UDim2.new(0, 300, 0, 100)
		partyChat.Visible = false
		text(partyRows, "✅ Account linked", UDim2.new(1, 0, 0, 24), UDim2.new(), FONT_B, 16, WHITE, Enum.TextXAlignment.Left)
		local hint = text(partyRows, "Join a party there and it shows up here.", UDim2.new(1, 0, 0, 30), UDim2.new(), FONT_M, 13, Color3.fromRGB(170, 200, 255), Enum.TextXAlignment.Left)
		hint.TextWrapped = true
		return
	end
	partyBox.Size = UDim2.new(0, 300, 0, 250)
	partyChat.Visible = true
	for _, m in members do
		local label = (m.Leader and "👑 " or "") .. tostring(m.Name) .. (m.Here and "  (here)" or "")
		local row = new("Frame", { Size = UDim2.new(1, 0, 0, 24), BackgroundTransparency = 1 }, partyRows)
		text(row, label, UDim2.new(0.6, 0, 1, 0), UDim2.new(), FONT_B, 15, WHITE, Enum.TextXAlignment.Left).TextTruncate = Enum.TextTruncate.AtEnd
		local st = (m.Ready and "✅ " or "") .. tostring(m.Status)
		text(row, st, UDim2.new(0.4, 0, 1, 0), UDim2.new(0.6, 0, 0, 0), FONT_M, 12, Color3.fromRGB(170, 200, 255), Enum.TextXAlignment.Right)
	end
	partyChat:ClearAllChildren()
	new("UIListLayout", { Padding = UDim.new(0, 1), VerticalAlignment = Enum.VerticalAlignment.Bottom }, partyChat)
	new("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingBottom = UDim.new(0, 4) }, partyChat)
	local chat = data.Chat or {}
	for i = math.max(1, #chat - 4), #chat do
		local c = chat[i]
		local l = text(partyChat, tostring(c.Name) .. ": " .. tostring(c.Text), UDim2.new(1, 0, 0, 18), UDim2.new(), FONT_M, 13, WHITE, Enum.TextXAlignment.Left)
		l.TextTruncate = Enum.TextTruncate.AtEnd
	end
end

-- client-only backdrop behind your character on the lobby stage
local Showcase = new("Folder", { Name = "LobbyBackdrop" }, workspace)
Lobby.Showcase = Showcase
table.insert(Core.ignore, Showcase)

function Lobby.buildBackdrop(pad: Vector3)
	Showcase:ClearAllChildren()
	local wall = new("Part", { Anchored = true, CanCollide = false, CanQuery = false, Size = Vector3.new(220, 120, 2), CFrame = CFrame.new(pad + Vector3.new(-10, 20, 30)), Color = Color3.fromRGB(20, 60, 180), Material = Enum.Material.SmoothPlastic }, Showcase)
	local sg = new("SurfaceGui", { Face = Enum.NormalId.Front, LightInfluence = 0, PixelsPerStud = 8 }, wall)
	local bg = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = WHITE, BorderSizePixel = 0 }, sg)
	gradient(bg, Color3.fromRGB(70, 170, 255), Color3.fromRGB(40, 20, 140), 90)
	for i = 1, 9 do
		local ray = new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.new(0, 60, 2, 0), Position = UDim2.new(0.12 * i - 0.05, 0, -0.5, 0), Rotation = (i - 5) * 9, BackgroundColor3 = WHITE, BackgroundTransparency = 0.88, BorderSizePixel = 0 }, bg)
		gradient(ray, WHITE, Color3.fromRGB(150, 200, 255), 90)
	end
	new("Part", { Anchored = true, CanCollide = false, CanQuery = false, Shape = Enum.PartType.Cylinder, Size = Vector3.new(1, 70, 70), CFrame = CFrame.new(pad - Vector3.new(0, 1.2, 0)) * CFrame.Angles(0, 0, math.rad(90)), Color = Color3.fromRGB(25, 40, 110), Material = Enum.Material.SmoothPlastic }, Showcase)
	local lamp = new("Part", { Anchored = true, CanCollide = false, CanQuery = false, Transparency = 1, Size = Vector3.one, CFrame = CFrame.lookAt(pad + Vector3.new(-3, 10, -10), pad + Vector3.new(0, 3, 0)) }, Showcase)
	new("SpotLight", { Brightness = 4, Range = 30, Angle = 60, Color = Color3.fromRGB(255, 245, 230) }, lamp)
end

return Lobby
