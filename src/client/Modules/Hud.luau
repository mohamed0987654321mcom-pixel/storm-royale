-- Hud: health/shield, hotbar, materials, minimap, storm timer, kill feed, crosshair, messages

local TweenService = game:GetService("TweenService")
local HttpService = game:GetService("HttpService")
local Debris = game:GetService("Debris")

local Core = require(script.Parent.Core)
local C, Net, State, S, plr, cam = Core.C, Core.Net, Core.State, Core.S, Core.plr, Core.cam
local new, corner, stroke, text, button = Core.new, Core.corner, Core.stroke, Core.text, Core.button
local WHITE, YELLOW, FONT_H, FONT_B, FONT_M, TOUCH = Core.WHITE, Core.YELLOW, Core.FONT_H, Core.FONT_B, Core.FONT_M, Core.TOUCH
local rarityColor, fmtTime = Core.rarityColor, Core.fmtTime
local gui = Core.gui

local Hud = {}
local UI: { [string]: any } = {}
Hud.UI = UI

local HUD = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false }, gui)
Hud.HUD = HUD

-- shield + health (bottom-left)
do
	local box = new("Frame", { Size = UDim2.new(0, 330, 0, 64), Position = UDim2.new(0, 24, 1, -90), BackgroundTransparency = 1 }, HUD)
	local function bar(y: number, color: Color3, icon: string)
		local bg = new("Frame", { Size = UDim2.new(1, -50, 0, 24), Position = UDim2.new(0, 46, 0, y), BackgroundColor3 = Color3.fromRGB(20, 20, 30), BackgroundTransparency = 0.3, BorderSizePixel = 0 }, box)
		corner(bg, 4)
		local fill = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = color, BorderSizePixel = 0 }, bg)
		corner(fill, 4)
		local num = text(bg, "100", UDim2.new(1, -10, 1, 0), UDim2.new(0, 0, 0, 0), FONT_H, 20, WHITE, Enum.TextXAlignment.Right)
		text(box, icon, UDim2.new(0, 40, 0, 24), UDim2.new(0, 0, 0, y), FONT_H, 22, color)
		return fill, num
	end
	UI.ShieldFill, UI.ShieldNum = bar(0, Color3.fromRGB(60, 160, 255), "🛡")
	UI.HealthFill, UI.HealthNum = bar(32, Color3.fromRGB(80, 220, 80), "✚")
end

-- hotbar (bottom-right; bottom-center on touch)
UI.Slots = {}
do
	local pos = TOUCH and UDim2.new(0.5, -6 * 74 + 60, 1, -90) or UDim2.new(1, -6 * 74 - 24, 1, -98)
	local bar = new("Frame", { Size = UDim2.new(0, 6 * 74, 0, 74), Position = pos, BackgroundTransparency = 1 }, HUD)
	UI.Hotbar = bar
	for i = 1, C.SLOTS do
		local b = new("TextButton", { Text = "", Size = UDim2.new(0, 66, 0, 66), Position = UDim2.new(0, (i - 1) * 74, 0, 4), BackgroundColor3 = Color3.fromRGB(30, 30, 40), BackgroundTransparency = 0.35, BorderSizePixel = 0, AutoButtonColor = false }, bar)
		corner(b, 6)
		local st = new("UIStroke", { Color = WHITE, Thickness = 0, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, b)
		local name = text(b, "", UDim2.new(1, -4, 0, 30), UDim2.new(0, 2, 0, 6), FONT_B, 11, WHITE)
		name.TextWrapped = true
		local cnt = text(b, "", UDim2.new(1, -6, 0, 18), UDim2.new(0, 0, 1, -20), FONT_H, 16, WHITE, Enum.TextXAlignment.Right)
		text(b, tostring(i), UDim2.new(0, 16, 0, 16), UDim2.new(0, 4, 1, -18), FONT_B, 12, Color3.fromRGB(200, 200, 200), Enum.TextXAlignment.Left)
		b.MouseButton1Click:Connect(function()
			S.Building = false
			Net:FireServer("Equip", i)
		end)
		UI.Slots[i] = { Btn = b, Stroke = st, Name = name, Count = cnt }
	end
	UI.AmmoL = text(HUD, "", UDim2.new(0, 260, 0, 40), UDim2.new(1, -284, 1, -150), FONT_H, 34, WHITE, Enum.TextXAlignment.Right)
	UI.AmmoSub = text(HUD, "", UDim2.new(0, 260, 0, 20), UDim2.new(1, -284, 1, -118), FONT_M, 14, Color3.fromRGB(210, 210, 210), Enum.TextXAlignment.Right)
end

-- materials (right side)
UI.Mats = {}
do
	local col = new("Frame", { Size = UDim2.new(0, 110, 0, 110), Position = UDim2.new(1, -134, 1, -280), BackgroundTransparency = 1 }, HUD)
	for i, m in C.MatOrder do
		local row = new("Frame", { Size = UDim2.new(1, 0, 0, 32), Position = UDim2.new(0, 0, 0, (i - 1) * 36), BackgroundColor3 = Color3.fromRGB(20, 20, 30), BackgroundTransparency = 0.4 }, col)
		corner(row, 4)
		local sw = new("Frame", { Size = UDim2.new(0, 22, 0, 22), Position = UDim2.new(0, 5, 0, 5), BackgroundColor3 = C.Materials[m].Color }, row)
		corner(sw, 4)
		local n = text(row, "0", UDim2.new(1, -36, 1, 0), UDim2.new(0, 30, 0, 0), FONT_H, 20, WHITE, Enum.TextXAlignment.Right)
		UI.Mats[i] = { Row = row, Num = n }
	end
end

-- minimap / full map (top-right, M to enlarge) — visible outside the lobby
local MAP_R = 1150
UI.MapGroup = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false }, gui)
UI.Map = new("Frame", { Size = UDim2.new(0, 210, 0, 210), Position = UDim2.new(1, -230, 0, 20), BackgroundColor3 = Color3.fromRGB(40, 110, 200), ClipsDescendants = true, ZIndex = 5 }, UI.MapGroup)
corner(UI.Map, 8)
stroke(UI.Map, Color3.fromRGB(10, 20, 50), 3)
local function mapCircle(r: number, color: Color3, transp: number, strokeColor: Color3?, z: number?): any
	local f = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(r / MAP_R, r / MAP_R), BackgroundColor3 = color, BackgroundTransparency = transp, ZIndex = z or 1 }, UI.Map)
	new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, f)
	if strokeColor then
		new("UIStroke", { Color = strokeColor, Thickness = 2 }, f)
	end
	return f
end
local function mapPos(x: number, z: number): UDim2
	return UDim2.fromScale(0.5 + x / (2 * MAP_R), 0.5 + z / (2 * MAP_R))
end
mapCircle(C.ISLAND_R + 50, Color3.fromRGB(230, 210, 150), 0)
mapCircle(C.ISLAND_R, Color3.fromRGB(80, 170, 70), 0)
UI.PoiLabels = {}
for _, poi in C.POIs do
	local l = text(UI.Map, string.upper(poi.Name), UDim2.new(0, 120, 0, 14), mapPos(poi.Pos.X, poi.Pos.Y), FONT_B, 10, WHITE)
	l.AnchorPoint = Vector2.new(0.5, 0.5)
	l.TextStrokeTransparency = 0.2
	l.ZIndex = 3
	table.insert(UI.PoiLabels, l)
end
UI.StormCircle = mapCircle(1000, WHITE, 1, Color3.fromRGB(170, 70, 255), 2)
UI.SafeCircle = mapCircle(1000, WHITE, 1, WHITE, 2)
UI.BusLine = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), BackgroundColor3 = WHITE, BorderSizePixel = 0, Visible = false, ZIndex = 2 }, UI.Map)
UI.Arrow = text(UI.Map, "▲", UDim2.new(0, 18, 0, 18), UDim2.fromScale(0.5, 0.5), FONT_B, 16, YELLOW)
UI.Arrow.AnchorPoint = Vector2.new(0.5, 0.5)
UI.Arrow.ZIndex = 5
UI.Arrow.TextStrokeTransparency = 0
UI.BusIcon = text(UI.Map, "🚌", UDim2.new(0, 22, 0, 22), UDim2.fromScale(0.5, 0.5), FONT_B, 18, WHITE)
UI.BusIcon.AnchorPoint = Vector2.new(0.5, 0.5)
UI.BusIcon.ZIndex = 6
UI.BusIcon.Visible = false

local info = new("Frame", { Size = UDim2.new(0, 210, 0, 56), Position = UDim2.new(1, -230, 0, 236), BackgroundColor3 = Color3.fromRGB(15, 15, 30), BackgroundTransparency = 0.35 }, UI.MapGroup)
corner(info, 6)
UI.StormL = text(info, "", UDim2.new(1, -12, 0, 24), UDim2.new(0, 6, 0, 2), FONT_B, 14, WHITE, Enum.TextXAlignment.Left)
UI.AliveL = text(info, "👤 0", UDim2.new(0.5, -6, 0, 26), UDim2.new(0, 6, 0, 28), FONT_H, 20, WHITE, Enum.TextXAlignment.Left)
UI.KillsL = text(info, "🎯 0", UDim2.new(0.5, -6, 0, 26), UDim2.new(0.5, 0, 0, 28), FONT_H, 20, WHITE, Enum.TextXAlignment.Left)

-- kill feed (left)
UI.Feed = new("Frame", { Size = UDim2.new(0, 420, 0, 200), Position = UDim2.new(0, 20, 0.35, 0), BackgroundTransparency = 1 }, gui)
new("UIListLayout", { VerticalAlignment = Enum.VerticalAlignment.Bottom, Padding = UDim.new(0, 4) }, UI.Feed)

-- crosshair, hit marker and sniper scope
UI.Cross = new("Frame", { Size = UDim2.new(0, 60, 0, 60), Position = UDim2.new(0.5, -30, 0.5, -30), BackgroundTransparency = 1 }, HUD)
UI.CrossLines = {}
for i, v in { Vector2.new(0, -1), Vector2.new(0, 1), Vector2.new(-1, 0), Vector2.new(1, 0) } do
	local horiz = v.Y == 0
	local f = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Size = horiz and UDim2.new(0, 10, 0, 2) or UDim2.new(0, 2, 0, 10), BackgroundColor3 = WHITE, BorderSizePixel = 0 }, UI.Cross)
	stroke(f, Color3.new(0, 0, 0), 1)
	UI.CrossLines[i] = { F = f, V = v }
end
new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(0, 3, 0, 3), BackgroundColor3 = WHITE, BorderSizePixel = 0 }, UI.Cross)
UI.HitMark = text(HUD, "✕", UDim2.new(0, 40, 0, 40), UDim2.new(0.5, -20, 0.5, -20), FONT_B, 34, WHITE)
UI.HitMark.TextTransparency = 1
UI.Scope = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false }, HUD)
do
	local ring = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(0, 520, 0, 520), BackgroundTransparency = 1 }, UI.Scope)
	new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, ring)
	new("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = 400, Transparency = 0.05 }, ring)
	new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(1, 0, 0, 1), BackgroundColor3 = Color3.new(0, 0, 0), BorderSizePixel = 0 }, ring)
	new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(0, 1, 1, 0), BackgroundColor3 = Color3.new(0, 0, 0), BorderSizePixel = 0 }, ring)
end

-- big center messages
UI.Big = text(gui, "", UDim2.new(0, 900, 0, 70), UDim2.new(0.5, -450, 0.18, 0), FONT_H, 56, WHITE)
UI.Big.TextStrokeTransparency = 0
UI.Big.ZIndex = 20
UI.Sub = text(gui, "", UDim2.new(0, 900, 0, 30), UDim2.new(0.5, -450, 0.18, 66), FONT_B, 22, WHITE)
UI.Sub.ZIndex = 20
local bigId = 0
function Hud.bigMessage(t: string, sub: string?, color: Color3?, dur: number?)
	bigId += 1
	local id = bigId
	UI.Big.Text, UI.Sub.Text = t, sub or ""
	UI.Big.TextColor3 = color or WHITE
	UI.Big.TextTransparency, UI.Sub.TextTransparency = 0, 0
	UI.Big.Size = UDim2.new(0, 1100, 0, 90)
	TweenService:Create(UI.Big, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Size = UDim2.new(0, 900, 0, 70) }):Play()
	task.delay(dur or 3, function()
		if id == bigId then
			TweenService:Create(UI.Big, TweenInfo.new(0.5), { TextTransparency = 1 }):Play()
			TweenService:Create(UI.Sub, TweenInfo.new(0.5), { TextTransparency = 1 }):Play()
		end
	end)
end

UI.Banner = text(gui, "", UDim2.new(0, 800, 0, 40), UDim2.new(0.5, -400, 0, 80), FONT_H, 30, WHITE)
UI.Banner.TextStrokeTransparency = 0.2
UI.Banner.ZIndex = 15

-- progress bar (reload / healing)
UI.Prog = new("Frame", { Size = UDim2.new(0, 260, 0, 34), Position = UDim2.new(0.5, -130, 0.62, 0), BackgroundTransparency = 1, Visible = false }, HUD)
UI.ProgL = text(UI.Prog, "", UDim2.new(1, 0, 0, 18), UDim2.new(0, 0, 0, 0), FONT_B, 15, WHITE)
local pbg = new("Frame", { Size = UDim2.new(1, 0, 0, 8), Position = UDim2.new(0, 0, 0, 22), BackgroundColor3 = Color3.fromRGB(20, 20, 20), BorderSizePixel = 0 }, UI.Prog)
UI.ProgFill = new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = YELLOW, BorderSizePixel = 0 }, pbg)
local progToken = 0
function Hud.showProgress(label: string, dur: number)
	progToken += 1
	S.Using = (dur > 0) and string.sub(label, 1, 5) == "Using"
	if dur <= 0 then
		UI.Prog.Visible = false
		return
	end
	local id = progToken
	UI.Prog.Visible = true
	UI.ProgL.Text = label
	UI.ProgFill.Size = UDim2.fromScale(0, 1)
	TweenService:Create(UI.ProgFill, TweenInfo.new(dur, Enum.EasingStyle.Linear), { Size = UDim2.fromScale(1, 1) }):Play()
	task.delay(dur, function()
		if id == progToken then
			UI.Prog.Visible = false
			S.Using = false
		end
	end)
end

-- build bar
UI.BuildBar = new("Frame", { Size = UDim2.new(0, 4 * 84, 0, 92), Position = UDim2.new(0.5, -168, 1, -110), BackgroundTransparency = 1, Visible = false }, HUD)
UI.PieceBtns = {}
local pieceKeys = { Wall = "Z", Floor = "X", Ramp = "C", Roof = "V" }
local pieceIcons = { Wall = "▮", Floor = "▬", Ramp = "◢", Roof = "▲" }
for i, p in C.PieceOrder do
	local b = new("TextButton", { Text = "", Size = UDim2.new(0, 76, 0, 76), Position = UDim2.new(0, (i - 1) * 84, 0, 0), BackgroundColor3 = Color3.fromRGB(20, 60, 140), BackgroundTransparency = 0.25, AutoButtonColor = false }, UI.BuildBar)
	corner(b, 6)
	local st = new("UIStroke", { Color = WHITE, Thickness = 0 }, b)
	text(b, pieceIcons[p], UDim2.new(1, 0, 0, 40), UDim2.new(0, 0, 0, 6), FONT_B, 34, WHITE)
	text(b, string.upper(p), UDim2.new(1, 0, 0, 16), UDim2.new(0, 0, 0, 44), FONT_B, 12, WHITE)
	text(b, TOUCH and "" or pieceKeys[p], UDim2.new(1, 0, 0, 14), UDim2.new(0, 0, 0, 60), FONT_B, 11, Color3.fromRGB(200, 220, 255))
	b.MouseButton1Click:Connect(function()
		S.Piece = p
	end)
	UI.PieceBtns[p] = { Btn = b, Stroke = st }
end
UI.MatHint = text(UI.BuildBar, "", UDim2.new(1, 0, 0, 16), UDim2.new(0, 0, 1, -14), FONT_B, 13, WHITE)

-- damage + storm overlays
UI.Hurt = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(255, 0, 0), BackgroundTransparency = 1, ZIndex = 0 }, HUD)
UI.StormWarn = text(HUD, "⚠ YOU ARE IN THE STORM ⚠", UDim2.new(0, 600, 0, 30), UDim2.new(0.5, -300, 0, 130), FONT_H, 26, Color3.fromRGB(220, 150, 255))
UI.StormWarn.Visible = false

UI.LobbyBtn = button(gui, TOUCH and "◀ LOBBY" or "◀ LOBBY (L)", UDim2.new(0, 130, 0, 40), UDim2.new(0, 20, 0, 20), Color3.fromRGB(20, 40, 110), WHITE, 20)
UI.LobbyBtn.Visible = false
UI.LobbyBtn.MouseButton1Click:Connect(function()
	Net:FireServer("Menu")
end)

-- end-of-life / victory panel
UI.EndPanel = new("Frame", { Size = UDim2.new(0, 520, 0, 230), Position = UDim2.new(0.5, -260, 0, 40), BackgroundColor3 = Color3.fromRGB(10, 15, 40), BackgroundTransparency = 0.15, Visible = false, ZIndex = 30 }, gui)
corner(UI.EndPanel, 10)
UI.EndTitle = text(UI.EndPanel, "", UDim2.new(1, 0, 0, 90), UDim2.new(0, 0, 0, 10), FONT_H, 78, WHITE)
UI.EndTitle.ZIndex = 31
UI.EndSub = text(UI.EndPanel, "", UDim2.new(1, -20, 0, 50), UDim2.new(0, 10, 0, 100), FONT_B, 18, WHITE)
UI.EndSub.ZIndex = 31
UI.EndSub.TextWrapped = true
UI.EndBtn = button(UI.EndPanel, "RETURN TO LOBBY", UDim2.new(0, 280, 0, 50), UDim2.new(0.5, -140, 1, -66), YELLOW, Color3.fromRGB(20, 20, 20), 26)
UI.EndBtn.ZIndex = 31
UI.EndBtn.MouseButton1Click:Connect(function()
	UI.EndPanel.Visible = false
	S.Overlay = false
	Net:FireServer("Menu")
end)

function Hud.endPanel(title: string, sub: string, color: Color3)
	UI.EndTitle.Text = title
	UI.EndTitle.TextColor3 = color
	UI.EndSub.Text = sub
	UI.EndPanel.Visible = true
	UI.EndPanel.Size = UDim2.new(0, 560, 0, 250)
	TweenService:Create(UI.EndPanel, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Size = UDim2.new(0, 520, 0, 230) }):Play()
	S.Overlay = true
end

function Hud.addFeed(msg: string, color: Color3?)
	local l = text(UI.Feed, msg, UDim2.new(1, 0, 0, 22), UDim2.new(), FONT_B, 16, color or WHITE, Enum.TextXAlignment.Left)
	l.TextStrokeTransparency = 0.3
	task.delay(6, function()
		TweenService:Create(l, TweenInfo.new(0.6), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		Debris:AddItem(l, 0.7)
	end)
	local kids = {}
	for _, k in UI.Feed:GetChildren() do
		if k:IsA("TextLabel") then
			table.insert(kids, k)
		end
	end
	if #kids > 6 then
		kids[1]:Destroy()
	end
end

function Hud.setMapOpen(open: boolean)
	S.MapOpen = open
	UI.Map.Size = open and UDim2.new(0, 620, 0, 620) or UDim2.new(0, 210, 0, 210)
	UI.Map.Position = open and UDim2.new(0.5, -310, 0.5, -310) or UDim2.new(1, -230, 0, 20)
	for _, l in UI.PoiLabels do
		l.TextSize = open and 16 or 10
	end
end

-- redraw hotbar / materials / ammo from the inventory the server sent
function Hud.refreshInv()
	local inv = S.Inv
	if not inv then
		return
	end
	for i = 1, C.SLOTS do
		local u = UI.Slots[i]
		local it = inv.S[i]
		local sel = (inv.E == i) and not S.Building
		u.Stroke.Thickness = sel and 3 or 0
		u.Btn.Size = sel and UDim2.new(0, 72, 0, 72) or UDim2.new(0, 66, 0, 66)
		if it then
			u.Name.Text = string.upper(C.ItemName(it))
			if C.Weapons[it.Id] then
				u.Btn.BackgroundColor3 = rarityColor(it.R)
				u.Count.Text = tostring(it.Mag or 0)
			elseif it.N then
				u.Btn.BackgroundColor3 = Color3.fromRGB(60, 60, 80)
				u.Count.Text = tostring(it.N)
			else
				u.Btn.BackgroundColor3 = Color3.fromRGB(110, 60, 160)
				u.Count.Text = ""
			end
		else
			u.Name.Text = ""
			u.Count.Text = ""
			u.Btn.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
		end
	end
	for i, m in C.MatOrder do
		UI.Mats[i].Num.Text = tostring(inv.M[m] or 0)
		UI.Mats[i].Row.BackgroundTransparency = (inv.MS == i) and 0 or 0.4
		UI.Mats[i].Row.BackgroundColor3 = (inv.MS == i) and Color3.fromRGB(30, 80, 170) or Color3.fromRGB(20, 20, 30)
	end
	local eq = inv.S[inv.E]
	local w = eq and C.Weapons[eq.Id]
	if w and not S.Building then
		UI.AmmoL.Text = string.format("%d  |  %d", eq.Mag or 0, inv.A[w.Ammo] or 0)
		UI.AmmoSub.Text = string.upper(C.Rarities[eq.R or 1].Name .. " " .. w.Name)
		UI.AmmoSub.TextColor3 = rarityColor(eq.R)
	else
		UI.AmmoL.Text = ""
		UI.AmmoSub.Text = eq and not S.Building and string.upper(C.ItemName(eq)) or ""
		UI.AmmoSub.TextColor3 = WHITE
	end
	local mat = C.MatOrder[inv.MS or 1]
	UI.MatHint.Text = string.upper(mat) .. " (" .. tostring(inv.M[mat] or 0) .. ")" .. (TOUCH and "" or "  •  G: switch  •  R: rotate")
end

local function onInv()
	local raw = plr:GetAttribute("Inv")
	if type(raw) == "string" then
		local ok, d = pcall(HttpService.JSONDecode, HttpService, raw)
		if ok then
			S.Inv = d
			Hud.refreshInv()
		end
	end
end
plr:GetAttributeChangedSignal("Inv"):Connect(onInv)
onInv()

plr:GetAttributeChangedSignal("Kills"):Connect(function()
	UI.KillsL.Text = "🎯 " .. tostring(plr:GetAttribute("Kills") or 0)
end)

-------------------------------------------------------------------------------
-- per-frame update
-------------------------------------------------------------------------------
local function bannerText(): string
	local phase = State:GetAttribute("Phase")
	local m = S.Mode
	if m == "Warmup" then
		if phase == "Countdown" then
			return "SKY BUS LAUNCHES IN " .. fmtTime(State:GetAttribute("Countdown") or 0)
		elseif phase == "Waiting" then
			return "WAITING FOR PLAYERS..."
		end
		return "MATCH IN PROGRESS (" .. tostring(State:GetAttribute("Alive")) .. " LEFT)  •  YOU'LL JOIN THE NEXT ONE"
	elseif m == "Bus" then
		if State:GetAttribute("Doors") then
			return TOUCH and "TAP JUMP TO DROP!" or "PRESS SPACE TO JUMP!"
		end
		return "DOORS OPENING..."
	elseif m == "Dead" then
		local sp = S.Spectate
		return sp and ("SPECTATING " .. string.upper(sp.Name)) or ""
	end
	return ""
end

local lastPoiCheck = 0
function Hud.update(now: number, dt: number)
	local ch, hum, hrp = Core.myChar()
	if hum and ch then
		local hp = math.clamp(hum.Health, 0, 100)
		local sh = math.clamp(ch:GetAttribute("Shield") or 0, 0, 100)
		UI.HealthFill.Size = UDim2.fromScale(hp / 100, 1)
		UI.HealthNum.Text = tostring(math.ceil(hp))
		UI.ShieldFill.Size = UDim2.fromScale(sh / 100, 1)
		UI.ShieldNum.Text = tostring(math.floor(sh))
		if hp < 30 and UI.Hurt.BackgroundTransparency > 0.85 then
			UI.Hurt.BackgroundTransparency = 0.88
		elseif hp >= 30 and UI.Hurt.BackgroundTransparency == 0.88 then
			UI.Hurt.BackgroundTransparency = 1
		end
	end
	-- crosshair bloom
	S.Bloom = math.max(0, S.Bloom - dt * 2.5)
	local moving = hum and hum.MoveDirection.Magnitude > 0.1
	local gap = 6 + S.Bloom * 22 + (moving and 6 or 0) + (S.ADS and -3 or 0)
	for _, l in UI.CrossLines do
		l.F.Position = UDim2.new(0.5, l.V.X * (gap + 5), 0.5, l.V.Y * (gap + 5))
	end
	local it = Core.equipped()
	UI.Scope.Visible = S.ADS and it ~= nil and it.Id == "Sniper" and not S.Building
	UI.Cross.Visible = not UI.Scope.Visible
	UI.BuildBar.Visible = S.Building
	UI.Hotbar.Visible = not S.Building
	for p, b in UI.PieceBtns do
		b.Stroke.Thickness = (p == S.Piece) and 3 or 0
		b.Btn.BackgroundColor3 = (p == S.Piece) and Color3.fromRGB(40, 110, 230) or Color3.fromRGB(20, 60, 140)
	end
	-- storm timer / alive
	local t0, t1 = State:GetAttribute("StormT0") or 0, State:GetAttribute("StormT1") or 0
	local sp = State:GetAttribute("StormPhase") or 0
	if sp == 0 then
		UI.StormL.Text = "⏱ STORM: WAITING"
	elseif now < t0 then
		UI.StormL.Text = (sp == 1 and "⏱ STORM FORMS IN " or "⏱ SHRINKS IN ") .. fmtTime(t0 - now)
	elseif now < t1 then
		UI.StormL.Text = "⚡ STORM SHRINKING " .. fmtTime(t1 - now)
		if S.ShrinkSeen ~= sp and S.Mode == "Match" then
			S.ShrinkSeen = sp
			Hud.bigMessage("STORM EYE SHRINKING", "Get inside the white circle!", Color3.fromRGB(210, 150, 255), 3)
		end
	else
		UI.StormL.Text = "⏱ STORM: HOLDING"
	end
	UI.AliveL.Text = "👤 " .. tostring(State:GetAttribute("Alive") or 0)
	UI.Banner.Text = bannerText()
	if UI.ThanksBtn then
		UI.ThanksBtn.Visible = S.Mode == "Bus"
	end
	-- map circles, bus route, your arrow
	local c, r = C.StormAt(State, now)
	local showStorm = sp > 0
	UI.StormCircle.Visible = showStorm
	UI.SafeCircle.Visible = showStorm
	UI.StormCircle.Position = mapPos(c.X, c.Y)
	UI.StormCircle.Size = UDim2.fromScale(r / MAP_R, r / MAP_R)
	local nc: Vector2 = State:GetAttribute("StormC1") or Vector2.zero
	local nr: number = State:GetAttribute("StormR1") or 0
	UI.SafeCircle.Position = mapPos(nc.X, nc.Y)
	UI.SafeCircle.Size = UDim2.fromScale(nr / MAP_R, nr / MAP_R)
	local A, B = State:GetAttribute("BusA"), State:GetAttribute("BusB")
	local bt0, bt1 = State:GetAttribute("BusT0") or 0, State:GetAttribute("BusT1") or 0
	local busOn = typeof(A) == "Vector3" and typeof(B) == "Vector3" and now < bt1 + 5 and S.Mode ~= "Warmup"
	UI.BusLine.Visible = busOn
	UI.BusIcon.Visible = busOn and now < bt1
	if busOn and typeof(A) == "Vector3" and typeof(B) == "Vector3" then
		local mid = (A + B) / 2
		local d = B - A
		UI.BusLine.Position = mapPos(mid.X, mid.Z)
		UI.BusLine.Size = UDim2.new(Vector2.new(d.X, d.Z).Magnitude / (2 * MAP_R), 0, 0, 3)
		UI.BusLine.Rotation = math.deg(math.atan2(d.Z, d.X))
		local bp = A:Lerp(B, math.clamp((now - bt0) / math.max(1, bt1 - bt0), 0, 1))
		UI.BusIcon.Position = mapPos(bp.X, bp.Z)
	end
	local focus = hrp and hrp.Position or cam.CFrame.Position
	UI.Arrow.Position = mapPos(focus.X, focus.Z)
	local lv = cam.CFrame.LookVector
	UI.Arrow.Rotation = math.deg(math.atan2(lv.X, -lv.Z))
	-- location name when you enter a POI
	if S.Mode == "Match" and hrp and now - lastPoiCheck > 0.5 then
		lastPoiCheck = now
		local name = ""
		for _, poi in C.POIs do
			if (Vector2.new(hrp.Position.X, hrp.Position.Z) - poi.Pos).Magnitude < 110 then
				name = poi.Name
			end
		end
		if name ~= S.PoiName then
			S.PoiName = name
			if name ~= "" and not (ch and ch:GetAttribute("Drop")) then
				Hud.bigMessage(string.upper(name), "", WHITE, 2.5)
			end
		end
	end
end

return Hud
