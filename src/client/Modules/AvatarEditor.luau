-- AvatarEditor: the MY STYLE editor in the LOCKER.
-- Dress up with the Roblox items you own (Roblox asks your permission once), and pick body colors and sizes.
-- Every change is saved (the server checks you own each item) and shows on your character on the stage.
-- 3D studio: while the editor is open the camera orbits your character: drag to spin, scroll / pinch to zoom,
-- FULL / FACE / BACK views and a turntable SPIN (the camera itself is in CameraCtl, driven by S.Studio).
-- Looks are shared with the website locker when your account is linked.

local AvatarEditorService = game:GetService("AvatarEditorService")
local UIS = game:GetService("UserInputService")

local Core = require(script.Parent.Core)
local Net, S, plr = Core.Net, Core.S, Core.plr
local new, corner, stroke, text, button, gradient = Core.new, Core.corner, Core.stroke, Core.text, Core.button, Core.gradient
local WHITE, YELLOW, FONT_H, FONT_B, FONT_M = Core.WHITE, Core.YELLOW, Core.FONT_H, Core.FONT_B, Core.FONT_M

local Editor = {}

-- keep in step with web/lib/looks.js and src/server/Modules/Avatar.luau
type TypeInfo = { cat: string, label: string, max: number, group: string?, rigid: boolean?, layered: boolean? }
local TYPES: { [string]: TypeInfo } = {
	Hat = { cat = "head", label = "Hat", max = 3, rigid = true },
	HairAccessory = { cat = "head", label = "Hair", max = 3, rigid = true },
	FaceAccessory = { cat = "head", label = "Face extra", max = 2, rigid = true },
	EyebrowAccessory = { cat = "head", label = "Eyebrows", max = 1, layered = true },
	EyelashAccessory = { cat = "head", label = "Eyelashes", max = 1, layered = true },
	Face = { cat = "head", label = "Face", max = 1 },
	TShirtAccessory = { cat = "clothes", label = "T-shirt", max = 1, layered = true },
	ShirtAccessory = { cat = "clothes", label = "Shirt", max = 1, layered = true },
	SweaterAccessory = { cat = "clothes", label = "Sweater", max = 1, layered = true },
	JacketAccessory = { cat = "clothes", label = "Jacket", max = 1, layered = true },
	PantsAccessory = { cat = "clothes", label = "Pants", max = 1, layered = true },
	ShortsAccessory = { cat = "clothes", label = "Shorts", max = 1, layered = true },
	DressSkirtAccessory = { cat = "clothes", label = "Dress/skirt", max = 1, layered = true },
	LeftShoeAccessory = { cat = "clothes", label = "Left shoe", max = 1, layered = true },
	RightShoeAccessory = { cat = "clothes", label = "Right shoe", max = 1, layered = true },
	Shirt = { cat = "clothes", label = "Classic shirt", max = 1 },
	Pants = { cat = "clothes", label = "Classic pants", max = 1 },
	TShirt = { cat = "clothes", label = "Classic T-shirt", max = 1 },
	NeckAccessory = { cat = "accessories", label = "Neck", max = 2, rigid = true },
	ShoulderAccessory = { cat = "accessories", label = "Shoulder", max = 2, rigid = true },
	FrontAccessory = { cat = "accessories", label = "Front", max = 2, rigid = true },
	BackAccessory = { cat = "accessories", label = "Back", max = 2, rigid = true },
	WaistAccessory = { cat = "accessories", label = "Waist", max = 2, rigid = true },
	DynamicHead = { cat = "body", label = "Head", max = 1, group = "head" },
	Head = { cat = "body", label = "Head", max = 1, group = "head" },
	Torso = { cat = "body", label = "Torso", max = 1 },
	LeftArm = { cat = "body", label = "Left arm", max = 1 },
	RightArm = { cat = "body", label = "Right arm", max = 1 },
	LeftLeg = { cat = "body", label = "Left leg", max = 1 },
	RightLeg = { cat = "body", label = "Right leg", max = 1 },
}
local RIGID_MAX, LAYERED_MAX, ITEMS_MAX = 10, 10, 40
local CATS = {
	{ Id = "head", Label = "HEAD" },
	{ Id = "clothes", Label = "CLOTHES" },
	{ Id = "accessories", Label = "EXTRAS" },
	{ Id = "body", Label = "BODY" },
	{ Id = "colors", Label = "COLORS" },
	{ Id = "size", Label = "SIZE" },
}
local PARTS = { "head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg" }
local PART_LABELS = { all = "ALL", head = "HEAD", torso = "TORSO", leftArm = "L ARM", rightArm = "R ARM", leftLeg = "L LEG", rightLeg = "R LEG" }
local SCALES = {
	{ "height", "HEIGHT", 0.9, 1.05, 1 },
	{ "width", "WIDTH", 0.7, 1, 1 },
	{ "head", "HEAD SIZE", 0.95, 1, 1 },
	{ "proportion", "SLENDER", 0, 1, 0 },
	{ "bodyType", "BODY TYPE", 0, 1, 0 },
}
local SWATCHES = {
	"#ffe0bd", "#f5cd9b", "#eab892", "#d4a373", "#c68642", "#a0662f", "#8d5524", "#5c3a21", "#3b2219",
	"#ffffff", "#e5e4df", "#a3a2a5", "#635f62", "#1b1b1b", "#ff4f6d", "#ff9a3d", "#ffdc32", "#47e27a",
	"#4b974b", "#00c2a8", "#6e99ca", "#3fa9ff", "#1b3fae", "#6a2fd1", "#ff66cc",
}
local PAGE = 60

local st = {
	open = false,
	look = nil :: any, -- what you're wearing (being edited)
	items = {} :: { any }, -- items you can wear: owned (after you allow it) + what you wear on Roblox
	itemIds = {} :: { [number]: boolean },
	invLoaded = false,
	reading = false,
	cat = "head",
	part = "all",
	shown = PAGE,
	pendingSave = false,
	saveToken = 0,
}

local function copy(t: any): any
	if type(t) ~= "table" then
		return t
	end
	local o = {}
	for k, v in t do
		o[k] = copy(v)
	end
	return o
end

local function blankLook(): any
	return { items = {}, colors = {}, scales = { height = 1, width = 1, head = 1, proportion = 0, bodyType = 0 } }
end

local function addItems(list: { any })
	for _, it in list do
		local id = tonumber(it.id)
		if id and TYPES[it.type] and not st.itemIds[id] then
			st.itemIds[id] = true
			table.insert(st.items, { id = id, type = it.type, name = tostring(it.name or "") })
		end
	end
end

-------------------------------------------------------------------------------
-- 3D studio camera
-------------------------------------------------------------------------------
local Studio = S.Studio
local VIEWS = {
	FULL = { Yaw = 0, Pitch = 0.08, Dist = 11, FocusY = 3 },
	FACE = { Yaw = 0, Pitch = 0.05, Dist = 4.6, FocusY = 4.5 },
	BACK = { Yaw = math.pi, Pitch = 0.12, Dist = 9.5, FocusY = 3.3 },
}
local lastManual = 0

local function setView(name: string)
	local v = VIEWS[name]
	-- keep spinning the short way round
	local yaw = v.Yaw
	while yaw - Studio.Yaw > math.pi do
		yaw -= 2 * math.pi
	end
	while Studio.Yaw - yaw > math.pi do
		yaw += 2 * math.pi
	end
	Studio.Yaw, Studio.Pitch, Studio.Dist, Studio.FocusY = yaw, v.Pitch, v.Dist, v.FocusY
end

local function zoomBy(delta: number)
	Studio.Dist = math.clamp(Studio.Dist + delta, 3.5, 15)
	-- closer = aim at the face, further = the whole body
	Studio.FocusY = 3 + (1 - (Studio.Dist - 3.5) / 11.5) * 1.5
	lastManual = os.clock()
end

-- drag anywhere that isn't the editor to spin; mouse wheel or pinch to zoom
local dragInput: InputObject? = nil
local lastPos: Vector3? = nil
UIS.InputBegan:Connect(function(input, processed)
	if not Studio.On or processed then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		dragInput = input
		lastPos = input.Position
	end
end)
UIS.InputChanged:Connect(function(input, processed)
	if not Studio.On then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseWheel then
		if not processed then
			zoomBy(-input.Position.Z * 1.2)
		end
		return
	end
	local d = dragInput
	if not d or not lastPos then
		return
	end
	local moving = input == d or (d.UserInputType == Enum.UserInputType.MouseButton1 and input.UserInputType == Enum.UserInputType.MouseMovement)
	if moving then
		local delta = input.Position - lastPos
		lastPos = input.Position
		Studio.Yaw -= delta.X * 0.012
		Studio.Pitch = math.clamp(Studio.Pitch + delta.Y * 0.006, -0.3, 0.75)
		Studio.Spin = false
		lastManual = os.clock()
	end
end)
UIS.InputEnded:Connect(function(input)
	if input == dragInput or (dragInput and input.UserInputType == Enum.UserInputType.MouseButton1 and dragInput.UserInputType == Enum.UserInputType.MouseButton1) then
		dragInput = nil
	end
end)
local pinchBase = Studio.Dist
UIS.TouchPinch:Connect(function(_, scale, _, state, processed)
	if not Studio.On or processed then
		return
	end
	if state == Enum.UserInputState.Begin then
		pinchBase = Studio.Dist
	elseif scale > 0 then
		zoomBy(pinchBase / scale - Studio.Dist)
	end
end)

-- a little sparkle when your look changes
local function sparkle()
	local char = plr.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	if not root then
		return
	end
	local att = new("Attachment", { Position = Vector3.new(0, 0.5, 0) }, root)
	local pe = new("ParticleEmitter", {
		Texture = "rbxasset://textures/particles/sparkles_main.dds",
		Color = ColorSequence.new(YELLOW, Color3.fromRGB(150, 220, 255)),
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.6), NumberSequenceKeypoint.new(1, 0) }),
		Lifetime = NumberRange.new(0.6, 1.1),
		Speed = NumberRange.new(4, 9),
		SpreadAngle = Vector2.new(180, 180),
		LightEmission = 1,
		Rate = 0,
	}, att)
	pe:Emit(30)
	task.delay(1.5, function()
		att:Destroy()
	end)
end

-------------------------------------------------------------------------------
-- UI
-------------------------------------------------------------------------------
local panel, statusL, tabsF, body, footer, viewBar, spinBtn
local closeCb: (() -> ())? = nil
local tabButtons: { [string]: TextButton } = {}
local render: () -> ()

local function wearing(id: number): boolean
	for _, it in st.look.items do
		if it.id == id then
			return true
		end
	end
	return false
end

local function setStatus(s: string, col: Color3?)
	if statusL then
		statusL.Text = s
		statusL.TextColor3 = col or Color3.fromRGB(190, 205, 255)
	end
end

-- save shortly after the last change (one save for a quick burst of taps)
local function scheduleSave()
	st.pendingSave = true
	st.saveToken += 1
	local token = st.saveToken
	setStatus("● changes…", YELLOW)
	task.delay(0.35, function()
		if token ~= st.saveToken then
			return
		end
		setStatus("Saving…", YELLOW)
		Net:FireServer("AvatarSave", st.look)
	end)
end

local function removeItem(id: number)
	for i, it in st.look.items do
		if it.id == id then
			table.remove(st.look.items, i)
			return
		end
	end
end

local function count(pred: (any) -> boolean): number
	local n = 0
	for _, it in st.look.items do
		if pred(it) then
			n += 1
		end
	end
	return n
end

local function toggle(item)
	if wearing(item.id) then
		removeItem(item.id)
		return true
	end
	local def = TYPES[item.type]
	-- slot already full: swap out the first one
	local max = def.group and 1 or def.max
	local same = {}
	for _, it in st.look.items do
		local d2 = TYPES[it.type]
		if (def.group and d2 and d2.group == def.group) or (not def.group and it.type == item.type) then
			table.insert(same, it)
		end
	end
	if #same >= max then
		removeItem(same[1].id)
	end
	if def.rigid and count(function(it)
		return TYPES[it.type] ~= nil and TYPES[it.type].rigid == true
	end) >= RIGID_MAX then
		Core.toast("You can wear up to " .. RIGID_MAX .. " accessories. Take one off first.")
		return false
	end
	if def.layered and count(function(it)
		return TYPES[it.type] ~= nil and TYPES[it.type].layered == true
	end) >= LAYERED_MAX then
		Core.toast("You can wear up to " .. LAYERED_MAX .. " layered clothes.")
		return false
	end
	if #st.look.items >= ITEMS_MAX then
		Core.toast("That's the most items one look can have.")
		return false
	end
	table.insert(st.look.items, { id = item.id, type = item.type, name = item.name })
	return true
end

local function smallButton(parent: Instance, label: string, w: number, active: boolean?, onClick: () -> ()): TextButton
	local b = button(parent, label, UDim2.new(0, w, 0, 32), UDim2.new(), active and YELLOW or Color3.fromRGB(35, 55, 130), active and Color3.fromRGB(25, 20, 0) or WHITE, 16)
	b.MouseButton1Click:Connect(onClick)
	return b
end

-- reads every item you own (Roblox shows its own "allow" prompt first) and shares the list with the server
local function readInventory()
	if st.reading then
		return
	end
	st.reading = true
	setStatus("Waiting for Roblox…", YELLOW)
	local okPrompt = pcall(function()
		AvatarEditorService:PromptAllowInventoryReadAccess()
	end)
	local result = okPrompt and AvatarEditorService.PromptAllowInventoryReadAccessCompleted:Wait() or nil
	if result ~= Enum.AvatarPromptResult.Success then
		st.reading = false
		setStatus("")
		Core.toast("No problem! You can still use the items you're wearing.")
		return
	end
	setStatus("Loading your items…", YELLOW)
	local assetTypes = {}
	for name in TYPES do
		local ok, e = pcall(function()
			return (Enum.AvatarAssetType :: any)[name]
		end)
		if ok and e then
			table.insert(assetTypes, e)
		end
	end
	local okPages, pages = pcall(function()
		return AvatarEditorService:GetInventoryAsync(assetTypes)
	end)
	if not okPages then
		okPages, pages = pcall(function()
			return (AvatarEditorService :: any):GetInventory(assetTypes)
		end)
	end
	local found = {}
	if okPages and pages then
		while true do
			local okPage, page = pcall(function()
				return pages:GetCurrentPage()
			end)
			if not okPage then
				break
			end
			for _, it in page do
				local id = tonumber(it.AssetId or it.Id)
				local t = it.AssetType
				if typeof(t) == "EnumItem" then
					t = (t :: EnumItem).Name
				end
				t = tostring(t)
				if id and TYPES[t] then
					table.insert(found, { id = id, type = t, name = tostring(it.Name or "") })
				end
			end
			if pages.IsFinished or #found >= 3000 then
				break
			end
			if not pcall(function()
				pages:AdvanceToNextPageAsync()
			end) then
				break
			end
		end
	end
	st.reading = false
	if #found == 0 then
		setStatus("")
		Core.toast(okPages and "No items found yet. Get some on the Roblox Marketplace!" or "Couldn't load your items right now. Try again soon.")
		return
	end
	addItems(found)
	st.invLoaded = true
	-- share with the server (and, if linked, the website locker) in small pieces
	for i = 1, #found, 400 do
		local chunk = table.move(found, i, math.min(i + 399, #found), 1, {})
		Net:FireServer("AvatarInventory", chunk, i + 400 > #found)
	end
	setStatus(#found .. " items", Color3.fromRGB(150, 255, 170))
	render()
end

local function itemCard(parent: Instance, item, order: number)
	local on = wearing(item.id)
	local def = TYPES[item.type]
	local b = new("TextButton", { Text = "", AutoButtonColor = true, BackgroundColor3 = on and Color3.fromRGB(120, 95, 10) or Color3.fromRGB(28, 44, 110), BorderSizePixel = 0, LayoutOrder = order }, parent)
	corner(b, 8)
	if on then
		stroke(b, YELLOW, 3)
	end
	local picBg = new("Frame", { Size = UDim2.new(1, -10, 1, -40), Position = UDim2.new(0, 5, 0, 5), BackgroundColor3 = Color3.fromRGB(225, 232, 250), BorderSizePixel = 0 }, b)
	corner(picBg, 6)
	new("ImageLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Image = "rbxthumb://type=Asset&id=" .. item.id .. "&w=150&h=150", ScaleType = Enum.ScaleType.Fit }, picBg)
	local nm = text(b, item.name ~= "" and item.name or def.label, UDim2.new(1, -8, 0, 32), UDim2.new(0, 4, 1, -34), FONT_M, 11, WHITE)
	nm.TextWrapped = true
	nm.TextTruncate = Enum.TextTruncate.AtEnd
	if on then
		local tick = text(b, "✓", UDim2.new(0, 22, 0, 22), UDim2.new(1, -26, 0, 4), FONT_B, 16, Color3.fromRGB(25, 20, 0))
		tick.BackgroundTransparency = 0
		tick.BackgroundColor3 = YELLOW
		corner(tick, 11)
	end
	b.MouseButton1Click:Connect(function()
		if toggle(item) then
			scheduleSave()
		end
		render()
	end)
end

local function renderItems()
	local top = new("Frame", { Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1 }, body)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), VerticalAlignment = Enum.VerticalAlignment.Center }, top)
	smallButton(top, st.invLoaded and "↻ REFRESH MY ITEMS" or "🎒 SHOW MY ITEMS", 200, not st.invLoaded, function()
		task.spawn(readInventory)
	end)
	if not st.invLoaded then
		local hint = text(top, "Showing what you wear on Roblox. Tap to add everything you own.", UDim2.new(1, -210, 1, 0), UDim2.new(), FONT_M, 12, Color3.fromRGB(190, 205, 255), Enum.TextXAlignment.Left)
		hint.TextWrapped = true
	end

	local list = {}
	for _, it in st.items do
		if TYPES[it.type].cat == st.cat then
			table.insert(list, it)
		end
	end
	table.sort(list, function(a, b)
		local wa, wb = wearing(a.id), wearing(b.id)
		if wa ~= wb then
			return wa
		end
		return a.id > b.id -- newest first
	end)
	local scroll = new("ScrollingFrame", {
		Size = UDim2.new(1, 0, 1, -44),
		Position = UDim2.new(0, 0, 0, 44),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, body)
	new("UIGridLayout", { CellSize = UDim2.new(0, 104, 0, 136), CellPadding = UDim2.new(0, 8, 0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, scroll)
	if #list == 0 then
		local e = text(scroll, "Nothing here yet. Tap SHOW MY ITEMS, or get items on the Roblox Marketplace.", UDim2.new(1, -20, 0, 60), UDim2.new(0, 10, 0, 10), FONT_M, 14, Color3.fromRGB(190, 205, 255))
		e.TextWrapped = true
		return
	end
	for i = 1, math.min(#list, st.shown) do
		itemCard(scroll, list[i], i)
	end
	if #list > st.shown then
		local more = button(scroll, "MORE (" .. (#list - st.shown) .. ")", UDim2.new(), UDim2.new(), Color3.fromRGB(35, 55, 130), WHITE, 16)
		more.LayoutOrder = st.shown + 1
		more.MouseButton1Click:Connect(function()
			st.shown += PAGE
			render()
		end)
	end
end

local function renderColors()
	local row = new("Frame", { Size = UDim2.new(1, 0, 0, 74), BackgroundTransparency = 1 }, body)
	new("UIGridLayout", { CellSize = UDim2.new(0, 80, 0, 32), CellPadding = UDim2.new(0, 6, 0, 6) }, row)
	for _, p in { "all", table.unpack(PARTS) } do
		smallButton(row, PART_LABELS[p], 80, st.part == p, function()
			st.part = p
			render()
		end)
	end
	local grid = new("Frame", { Size = UDim2.new(1, 0, 1, -84), Position = UDim2.new(0, 0, 0, 84), BackgroundTransparency = 1 }, body)
	new("UIGridLayout", { CellSize = UDim2.new(0, 48, 0, 48), CellPadding = UDim2.new(0, 8, 0, 8) }, grid)
	local current = st.look.colors[st.part == "all" and "torso" or st.part]
	for _, hex in SWATCHES do
		local sw = new("TextButton", { Text = "", BackgroundColor3 = Color3.fromHex(hex), AutoButtonColor = true, BorderSizePixel = 0 }, grid)
		corner(sw, 8)
		stroke(sw, current == hex and YELLOW or Color3.fromRGB(255, 255, 255), current == hex and 4 or 1)
		sw.MouseButton1Click:Connect(function()
			local parts = st.part == "all" and PARTS or { st.part }
			for _, p in parts do
				st.look.colors[p] = hex
			end
			scheduleSave()
			render()
		end)
	end
end

local function renderSizes()
	local list = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1 }, body)
	new("UIListLayout", { Padding = UDim.new(0, 10) }, list)
	for _, sc in SCALES do
		local key, label, lo, hi = sc[1], sc[2], sc[3], sc[4]
		local stepSize = (hi - lo) / 10
		local row = new("Frame", { Size = UDim2.new(1, 0, 0, 44), BackgroundColor3 = Color3.fromRGB(20, 34, 90), BackgroundTransparency = 0.2 }, list)
		corner(row, 8)
		text(row, label, UDim2.new(0.45, 0, 1, 0), UDim2.new(0, 12, 0, 0), FONT_H, 20, WHITE, Enum.TextXAlignment.Left)
		local v = st.look.scales[key] or sc[5]
		local valL = text(row, math.round(v * 100) .. "%", UDim2.new(0, 70, 1, 0), UDim2.new(1, -150, 0, 0), FONT_H, 20, YELLOW)
		local function change(dir: number)
			local nv = math.clamp(math.round(((st.look.scales[key] or sc[5]) + dir * stepSize) * 100) / 100, lo, hi)
			st.look.scales[key] = nv
			valL.Text = math.round(nv * 100) .. "%"
			scheduleSave()
		end
		local minus = button(row, "–", UDim2.new(0, 36, 0, 32), UDim2.new(1, -194, 0.5, -16), Color3.fromRGB(35, 55, 130), WHITE, 22)
		minus.MouseButton1Click:Connect(function()
			change(-1)
		end)
		local plus = button(row, "+", UDim2.new(0, 36, 0, 32), UDim2.new(1, -76, 0.5, -16), Color3.fromRGB(35, 55, 130), WHITE, 22)
		plus.MouseButton1Click:Connect(function()
			change(1)
		end)
	end
end

render = function()
	if not panel or not st.open then
		return
	end
	for id, b in tabButtons do
		b.BackgroundColor3 = (id == st.cat) and YELLOW or Color3.fromRGB(35, 55, 130)
		b.TextColor3 = (id == st.cat) and Color3.fromRGB(25, 20, 0) or WHITE
	end
	body:ClearAllChildren()
	if st.cat == "colors" then
		renderColors()
	elseif st.cat == "size" then
		renderSizes()
	else
		renderItems()
	end
end

-- builds the editor inside the LOCKER page (hidden until opened)
function Editor.build(page: Instance, onClose: () -> ())
	closeCb = onClose
	panel = new("Frame", { Size = UDim2.new(0.5, 0, 1, -36), Position = UDim2.new(1, -16, 0, 18), AnchorPoint = Vector2.new(1, 0), BackgroundColor3 = Color3.fromRGB(10, 20, 60), BackgroundTransparency = 0.12, Visible = false }, page)
	panel.Active = true -- taps on the editor don't spin the camera
	new("UISizeConstraint", { MaxSize = Vector2.new(720, math.huge), MinSize = Vector2.new(420, 0) }, panel)
	corner(panel, 12)
	stroke(panel, Color3.fromRGB(70, 110, 230), 2)
	new("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12), PaddingTop = UDim.new(0, 10), PaddingBottom = UDim.new(0, 10) }, panel)

	text(panel, "MY STYLE", UDim2.new(0, 200, 0, 40), UDim2.new(), FONT_H, 32, YELLOW, Enum.TextXAlignment.Left)
	statusL = text(panel, "", UDim2.new(1, -260, 0, 40), UDim2.new(0, 200, 0, 0), FONT_B, 14, Color3.fromRGB(190, 205, 255), Enum.TextXAlignment.Right)
	local close = button(panel, "✕", UDim2.new(0, 40, 0, 36), UDim2.new(1, -40, 0, 2), Color3.fromRGB(35, 55, 130), WHITE, 20)
	close.MouseButton1Click:Connect(function()
		Editor.close()
	end)

	tabsF = new("Frame", { Size = UDim2.new(1, 0, 0, 36), Position = UDim2.new(0, 0, 0, 46), BackgroundTransparency = 1 }, panel)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 6) }, tabsF)
	for _, c in CATS do
		local b = button(tabsF, c.Label, UDim2.new(1 / #CATS, -6, 1, 0), UDim2.new(), Color3.fromRGB(35, 55, 130), WHITE, 16)
		b.MouseButton1Click:Connect(function()
			st.cat = c.Id
			st.shown = PAGE
			-- point the camera at what you're changing (unless you just moved it yourself)
			if os.clock() - lastManual > 4 then
				Studio.Spin = false
				setView(c.Id == "head" and "FACE" or "FULL")
			end
			render()
		end)
		tabButtons[c.Id] = b
	end

	body = new("Frame", { Size = UDim2.new(1, 0, 1, -142), Position = UDim2.new(0, 0, 0, 92), BackgroundTransparency = 1, ClipsDescendants = true }, panel)

	footer = new("Frame", { Size = UDim2.new(1, 0, 0, 40), Position = UDim2.new(0, 0, 1, -40), BackgroundTransparency = 1 }, panel)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), HorizontalAlignment = Enum.HorizontalAlignment.Right }, footer)
	local reset = button(footer, "NORMAL AVATAR", UDim2.new(0, 170, 1, 0), UDim2.new(), Color3.fromRGB(35, 55, 130), WHITE, 17)
	reset.MouseButton1Click:Connect(function()
		st.saveToken += 1
		Net:FireServer("AvatarReset")
		setStatus("Back to normal…", YELLOW)
	end)
	local toRoblox = button(footer, "SAVE TO MY ROBLOX AVATAR", UDim2.new(0, 260, 1, 0), UDim2.new(), YELLOW, Color3.fromRGB(25, 20, 0), 17)
	gradient(toRoblox, Color3.fromRGB(255, 240, 90), Color3.fromRGB(255, 190, 20), 90)
	toRoblox.MouseButton1Click:Connect(function()
		Editor.saveToRoblox()
	end)

	-- 3D studio controls, floating under your character
	viewBar = new("Frame", { Size = UDim2.new(0, 420, 0, 74), Position = UDim2.new(0, 24, 1, -92), BackgroundTransparency = 1, Visible = false }, page)
	local row = new("Frame", { Size = UDim2.new(1, 0, 0, 40), BackgroundTransparency = 1 }, viewBar)
	new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8) }, row)
	for _, name in { "FULL", "FACE", "BACK" } do
		local b = button(row, name, UDim2.new(0, 90, 1, 0), UDim2.new(), Color3.fromRGB(20, 34, 90), WHITE, 18)
		stroke(b, Color3.fromRGB(90, 130, 255), 2)
		b.MouseButton1Click:Connect(function()
			Studio.Spin = false
			setView(name)
			lastManual = os.clock()
		end)
	end
	spinBtn = button(row, "⟳ SPIN", UDim2.new(0, 110, 1, 0), UDim2.new(), Color3.fromRGB(20, 34, 90), WHITE, 18)
	stroke(spinBtn, YELLOW, 2)
	spinBtn.MouseButton1Click:Connect(function()
		Studio.Spin = not Studio.Spin
		spinBtn.BackgroundColor3 = Studio.Spin and YELLOW or Color3.fromRGB(20, 34, 90)
		spinBtn.TextColor3 = Studio.Spin and Color3.fromRGB(25, 20, 0) or WHITE
	end)
	text(viewBar, Core.TOUCH and "Drag to spin  •  pinch to zoom" or "Drag to spin  •  scroll to zoom", UDim2.new(1, 0, 0, 26), UDim2.new(0, 0, 0, 46), FONT_M, 14, Color3.fromRGB(200, 215, 255), Enum.TextXAlignment.Left)
end

function Editor.open()
	if not panel then
		return
	end
	st.open = true
	panel.Visible = true
	viewBar.Visible = true
	Studio.On = true
	Studio.Spin = false
	setView(st.cat == "head" and "FACE" or "FULL")
	local d = S.Data
	st.look = (d and type(d.Look) == "table") and copy(d.Look) or nil
	st.look = st.look or blankLook()
	st.look.items = st.look.items or {}
	st.look.colors = st.look.colors or {}
	st.look.scales = st.look.scales or blankLook().scales
	addItems(st.look.items) -- what you already wear in this look stays wearable
	setStatus(d and d.Outfit ~= "Default" and "Your outfit switches to MY STYLE when you change something" or "")
	Net:FireServer("AvatarStart") -- your normal Roblox avatar, as a starting point
	render()
end

function Editor.close()
	if not st.open then
		return
	end
	st.open = false
	Studio.On = false
	Studio.BlendUntil = os.clock() + 1.2 -- glide back to the normal lobby shot
	dragInput = nil
	if panel then
		panel.Visible = false
		viewBar.Visible = false
	end
	if closeCb then
		closeCb()
	end
end

function Editor.isOpen(): boolean
	return st.open
end

-- server: your normal Roblox avatar (used when you don't have a look yet) and the items you wear on Roblox
function Editor.onStart(data: any)
	if type(data) ~= "table" then
		return
	end
	if type(data.Worn) == "table" then
		addItems(data.Worn)
	end
	local d = S.Data
	if st.open and not (d and type(d.Look) == "table") and type(data.Roblox) == "table" and not st.pendingSave then
		st.look = copy(data.Roblox)
	end
	render()
end

function Editor.onSaved(info: any)
	st.pendingSave = false
	if type(info) ~= "table" then
		return
	end
	if info.Reset then
		st.look = blankLook()
		Net:FireServer("AvatarStart")
		setStatus("✓ Normal avatar", Color3.fromRGB(150, 255, 170))
		return
	end
	setStatus("✓ Saved", Color3.fromRGB(150, 255, 170))
	sparkle()
	if (info.NotOwned or 0) > 0 then
		Core.toast(info.NotOwned .. " item(s) were taken off because your Roblox account doesn't own them.")
	elseif (info.Unchecked or 0) > 0 then
		Core.toast("Roblox is busy: " .. info.Unchecked .. " item(s) couldn't be checked. Try again in a moment.")
	end
end

-- your saved data changed (for example a look saved on the website): show it unless you're mid-edit
function Editor.onData()
	if not st.open or st.pendingSave then
		return
	end
	local d = S.Data
	if d and type(d.Look) == "table" then
		st.look = copy(d.Look)
		st.look.items = st.look.items or {}
		st.look.colors = st.look.colors or {}
		st.look.scales = st.look.scales or blankLook().scales
		addItems(st.look.items)
		render()
	end
end

-- Roblox asks the player to confirm before their real avatar changes
function Editor.saveToRoblox()
	local char = plr.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not hum then
		return
	end
	local ok, desc = pcall(function()
		return hum:GetAppliedDescription()
	end)
	if not ok or not desc then
		Core.toast("Couldn't read your look right now. Try again in a moment.")
		return
	end
	if not pcall(function()
		AvatarEditorService:PromptSaveAvatar(desc, hum.RigType)
	end) then
		Core.toast("Saving to Roblox isn't available right now.")
		return
	end
	local result = AvatarEditorService.PromptSaveAvatarCompleted:Wait()
	if result == Enum.AvatarPromptResult.Success then
		Core.toast("Saved as your Roblox avatar! 🎉")
	end
end

return Editor
