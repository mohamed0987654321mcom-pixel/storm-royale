-- Avatar: "MY STYLE" looks, made from the player's own Roblox items.
-- A look replaces the clothes and accessories of the player's normal Roblox avatar (in Storm Royale only),
-- and sets body colors and sizes. Body parts and the face come from their normal avatar unless the look has some.
-- Every item is checked with Roblox (MarketplaceService:PlayerOwnsAsset) before it's worn.
-- The same rules live in web/lib/looks.js on the website: keep the two in step.

local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

local Core = require(script.Parent.Core)
local Net = Core.Net

local Avatar = {}

type Def = { max: number, acc: Enum.AccessoryType?, layered: boolean?, order: number?, prop: string?, group: string?, rigid: boolean? }

local AT = Enum.AccessoryType
local TYPES: { [string]: Def } = {
	Hat = { max = 3, acc = AT.Hat, rigid = true },
	HairAccessory = { max = 3, acc = AT.Hair, rigid = true },
	FaceAccessory = { max = 2, acc = AT.Face, rigid = true },
	NeckAccessory = { max = 2, acc = AT.Neck, rigid = true },
	ShoulderAccessory = { max = 2, acc = AT.Shoulder, rigid = true },
	FrontAccessory = { max = 2, acc = AT.Front, rigid = true },
	BackAccessory = { max = 2, acc = AT.Back, rigid = true },
	WaistAccessory = { max = 2, acc = AT.Waist, rigid = true },
	-- layered clothing: higher order = worn on top
	EyebrowAccessory = { max = 1, acc = AT.Eyebrow, layered = true, order = 0 },
	EyelashAccessory = { max = 1, acc = AT.Eyelash, layered = true, order = 0 },
	LeftShoeAccessory = { max = 1, acc = AT.LeftShoe, layered = true, order = 1 },
	RightShoeAccessory = { max = 1, acc = AT.RightShoe, layered = true, order = 1 },
	PantsAccessory = { max = 1, acc = AT.Pants, layered = true, order = 2 },
	ShortsAccessory = { max = 1, acc = AT.Shorts, layered = true, order = 3 },
	DressSkirtAccessory = { max = 1, acc = AT.DressSkirt, layered = true, order = 4 },
	TShirtAccessory = { max = 1, acc = AT.TShirt, layered = true, order = 5 },
	ShirtAccessory = { max = 1, acc = AT.Shirt, layered = true, order = 6 },
	SweaterAccessory = { max = 1, acc = AT.Sweater, layered = true, order = 7 },
	JacketAccessory = { max = 1, acc = AT.Jacket, layered = true, order = 8 },
	-- classic clothing, face and body parts (HumanoidDescription properties)
	Shirt = { max = 1, prop = "Shirt" },
	Pants = { max = 1, prop = "Pants" },
	TShirt = { max = 1, prop = "GraphicTShirt" },
	Face = { max = 1, prop = "Face" },
	DynamicHead = { max = 1, prop = "Head", group = "head" },
	Head = { max = 1, prop = "Head", group = "head" },
	Torso = { max = 1, prop = "Torso" },
	LeftArm = { max = 1, prop = "LeftArm" },
	RightArm = { max = 1, prop = "RightArm" },
	LeftLeg = { max = 1, prop = "LeftLeg" },
	RightLeg = { max = 1, prop = "RightLeg" },
}
Avatar.TYPES = TYPES

local RIGID_MAX, LAYERED_MAX, ITEMS_MAX, INVENTORY_MAX = 10, 10, 40, 3000
local PARTS = { "head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg" }
local COLOR_PROP = { head = "HeadColor", torso = "TorsoColor", leftArm = "LeftArmColor", rightArm = "RightArmColor", leftLeg = "LeftLegColor", rightLeg = "RightLegColor" }
local SCALES = {
	height = { 0.9, 1.05, 1, "HeightScale" },
	width = { 0.7, 1, 1, "WidthScale" },
	head = { 0.95, 1, 1, "HeadScale" },
	proportion = { 0, 1, 0, "ProportionScale" },
	bodyType = { 0, 1, 0, "BodyTypeScale" },
}

-- worn-item types we can recognise from a HumanoidDescription accessory
local FROM_ACC: { [Enum.AccessoryType]: string } = {}
for name, def in TYPES do
	if def.acc then
		FROM_ACC[def.acc] = name
	end
end

local function validId(v: any): number?
	local n = tonumber(v)
	if n and n > 0 and n == math.floor(n) and n < 2 ^ 53 then
		return n
	end
	return nil
end

local function cleanName(v: any): string
	return string.sub(string.gsub(tostring(v or ""), "%c", ""), 1, 100)
end

-- Make a look safe (unknown types, bad ids, duplicates and anything over the limits are dropped)
function Avatar.sanitize(raw: any): any
	local items = {}
	if type(raw) ~= "table" then
		raw = {}
	end
	local seen, perType, perGroup = {}, {}, {}
	local rigid, layered = 0, 0
	if type(raw.items) == "table" then
		for _, it in raw.items do
			if type(it) ~= "table" then
				continue
			end
			local id, t = validId(it.id), tostring(it.type or "")
			local def = TYPES[t]
			if not id or not def or seen[id] then
				continue
			end
			local key = def.group or t
			local tooMany = (perType[t] or 0) >= def.max
				or (def.group ~= nil and (perGroup[key] or 0) >= 1)
				or (def.rigid == true and rigid >= RIGID_MAX)
				or (def.layered == true and layered >= LAYERED_MAX)
				or #items >= ITEMS_MAX
			if tooMany then
				continue
			end
			seen[id] = true
			perType[t] = (perType[t] or 0) + 1
			if def.group then
				perGroup[key] = 1
			end
			if def.rigid then
				rigid += 1
			end
			if def.layered then
				layered += 1
			end
			table.insert(items, { id = id, type = t, name = cleanName(it.name) })
		end
	end
	local colors = {}
	if type(raw.colors) == "table" then
		for _, p in PARTS do
			local hex = raw.colors[p]
			if type(hex) == "string" then
				local m = string.match(hex, "^#?(%x%x%x%x%x%x)$")
				if m then
					colors[p] = "#" .. string.lower(m)
				end
			end
		end
	end
	local scales = {}
	for k, r in SCALES do
		local v = type(raw.scales) == "table" and tonumber(raw.scales[k]) or nil
		scales[k] = v and math.round(math.clamp(v, r[1], r[2]) * 100) / 100 or r[3]
	end
	-- blocky: the classic blocky body instead of the account's own body parts (a Neoblox look)
	return { items = items, colors = colors, scales = scales, blocky = raw.blocky == true or nil }
end

function Avatar.sanitizeInventory(raw: any): { any }
	local out, seen = {}, {}
	if type(raw) ~= "table" then
		return out
	end
	for _, it in raw do
		if type(it) == "table" then
			local id, t = validId(it.id), tostring(it.type or "")
			if id and TYPES[t] and not seen[id] then
				seen[id] = true
				table.insert(out, { id = id, type = t, name = cleanName(it.name) })
				if #out >= INVENTORY_MAX then
					break
				end
			end
		end
	end
	return out
end

-------------------------------------------------------------------------------
-- Ownership (asked once per item per server, then remembered)
-------------------------------------------------------------------------------
local ownCache: { [Player]: { [number]: boolean } } = {}

local function owns(plr: Player, id: number): boolean?
	local c = ownCache[plr]
	if not c then
		c = {}
		ownCache[plr] = c
	end
	if c[id] ~= nil then
		return c[id]
	end
	local ok, res = pcall(MarketplaceService.PlayerOwnsAsset, MarketplaceService, plr, id)
	if not ok then
		return nil -- couldn't ask Roblox right now: not remembered, so it's asked again next time
	end
	c[id] = res == true
	return c[id]
end

-- keeps only items the player owns; returns the clean look, how many weren't owned, how many couldn't be checked
function Avatar.verify(plr: Player, look: any): (any, number, number)
	local clean = Avatar.sanitize(look)
	local kept, notOwned, unchecked = {}, 0, 0
	for _, it in clean.items do
		local o = owns(plr, it.id)
		if o == true then
			table.insert(kept, it)
		elseif o == false then
			notOwned += 1
		else
			unchecked += 1
		end
	end
	clean.items = kept
	return clean, notOwned, unchecked
end

-------------------------------------------------------------------------------
-- HumanoidDescription
-------------------------------------------------------------------------------
local baseCache: { [Player]: HumanoidDescription } = {}

-- the player's normal Roblox avatar (Studio test players have no real account, so they get a plain one)
local function baseDescription(plr: Player): HumanoidDescription
	local b = baseCache[plr]
	if not b and plr.UserId > 0 then
		local ok, d = pcall(Players.GetHumanoidDescriptionFromUserId, Players, plr.UserId)
		if ok and d then
			b = d
			baseCache[plr] = d
		end
	end
	return b and b:Clone() or Instance.new("HumanoidDescription")
end

function Avatar.describe(plr: Player, look: any): HumanoidDescription
	local desc = baseDescription(plr)
	local d = desc :: any
	-- clothes and accessories come only from the look
	d.Shirt, d.Pants, d.GraphicTShirt = 0, 0, 0
	-- a blocky look (e.g. someone's Neoblox character) wears the classic blocky body instead of the
	-- account's own body parts; body-part items in the look still win below
	if look.blocky then
		d.Head, d.Torso, d.LeftArm, d.RightArm, d.LeftLeg, d.RightLeg = 0, 0, 0, 0, 0, 0
	end
	local accessories = {}
	for _, it in look.items do
		local def = TYPES[it.type]
		if def and def.acc then
			if def.layered then
				table.insert(accessories, { AssetId = it.id, AccessoryType = def.acc, IsLayered = true, Order = def.order or 1, Puffiness = 1 })
			else
				table.insert(accessories, { AssetId = it.id, AccessoryType = def.acc, IsLayered = false })
			end
		elseif def and def.prop then
			d[def.prop] = it.id
		end
	end
	desc:SetAccessories(accessories, true)
	for part, prop in COLOR_PROP do
		local hex = look.colors[part]
		if hex then
			local ok, c = pcall(Color3.fromHex, hex)
			if ok then
				d[prop] = c
			end
		end
	end
	for k, r in SCALES do
		d[r[4]] = look.scales[k] or r[3]
	end
	return desc
end

-- what the player is wearing on Roblox right now, as builder items (names unknown: the client shows the type)
function Avatar.wornItems(plr: Player): { any }
	local desc = baseDescription(plr)
	local out = {}
	local ok, accs = pcall(function()
		return desc:GetAccessories(true)
	end)
	if ok and type(accs) == "table" then
		for _, a in accs do
			local t = FROM_ACC[a.AccessoryType]
			if t and validId(a.AssetId) then
				table.insert(out, { id = a.AssetId, type = t, name = "" })
			end
		end
	end
	local d = desc :: any
	for t, def in TYPES do
		if def.prop and t ~= "DynamicHead" then
			local id = validId(d[def.prop])
			if id then
				table.insert(out, { id = id, type = t, name = "" })
			end
		end
	end
	return Avatar.sanitizeInventory(out)
end

-- a look made from the player's normal Roblox avatar (the starting point of the editor)
function Avatar.lookFromRoblox(plr: Player): any
	local desc = baseDescription(plr) :: any
	local colors = {}
	for part, prop in COLOR_PROP do
		colors[part] = "#" .. (desc[prop] :: Color3):ToHex()
	end
	local scales = {}
	for k, r in SCALES do
		scales[k] = desc[r[4]]
	end
	return Avatar.sanitize({ items = Avatar.wornItems(plr), colors = colors, scales = scales })
end

-------------------------------------------------------------------------------
-- Spawning and live changes
-------------------------------------------------------------------------------
local function activeLook(plr: Player): any?
	local d = Core.Data[plr]
	if d and d.Outfit == "Default" and type(d.Look) == "table" then
		return d.Look
	end
	return nil
end

-- use instead of plr:LoadCharacter(): spawns with the player's MY STYLE look when they have one
function Avatar.spawn(plr: Player)
	local look = activeLook(plr)
	if look then
		local ok, err = pcall(function()
			local clean = Avatar.verify(plr, look)
			plr:LoadCharacterWithHumanoidDescription(Avatar.describe(plr, clean))
		end)
		if ok then
			return
		end
		warn("[Avatar] couldn't spawn with the look, using the normal avatar: " .. tostring(err))
	end
	plr:LoadCharacter()
end

-- dress the character right away when they're in the lobby or warm-up (never mid-match)
function Avatar.applyLive(plr: Player)
	local mode = plr:GetAttribute("Mode")
	if mode ~= "Menu" and mode ~= "Warmup" then
		return
	end
	local char = plr.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not hum or hum.Health <= 0 then
		return
	end
	local look = activeLook(plr)
	if not look then
		-- back to the normal avatar: a fresh spawn in the lobby is the cleanest way
		if mode == "Menu" then
			task.spawn(plr.LoadCharacter, plr)
		end
		return
	end
	local ok, err = pcall(function()
		local clean = Avatar.verify(plr, look)
		hum:ApplyDescription(Avatar.describe(plr, clean))
	end)
	if not ok then
		warn("[Avatar] couldn't apply the look: " .. tostring(err))
	end
end

-- store a new look (already verified) and show it; nil = back to the normal Roblox avatar
function Avatar.setLook(plr: Player, look: any?)
	local d = Core.Data[plr]
	if not d then
		return
	end
	d.Look = look
	if look then
		d.Outfit = "Default" -- the "Your Avatar" outfit is the one that wears MY STYLE
	end
	Core.pushData(plr)
	Avatar.applyLive(plr)
end

Players.PlayerRemoving:Connect(function(plr)
	ownCache[plr] = nil
	baseCache[plr] = nil
end)

-- the client asks for its starting point (normal avatar + worn items) when the editor opens
function Avatar.sendStart(plr: Player)
	Net:FireClient(plr, "AvatarStart", { Roblox = Avatar.lookFromRoblox(plr), Worn = Avatar.wornItems(plr) })
end

return Avatar
