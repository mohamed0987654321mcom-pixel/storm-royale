-- Inventory: slots, ammo, materials, and the item you hold in your hand

local TweenService = game:GetService("TweenService")
local HttpService = game:GetService("HttpService")

local Core = require(script.Parent.Core)
local C = Core.C
local P, weld, getChar = Core.P, Core.weld, Core.getChar

local Inventory = {}

function Inventory.newInv()
	return {
		Slots = { { Id = "Pickaxe" }, false, false, false, false, false },
		Eq = 1,
		Ammo = { Light = 0, Medium = 0, Heavy = 0, Shells = 0 },
		Mats = { Wood = 0, Brick = 0, Metal = 0 },
		MatSel = 1,
	}
end

-- push a player's inventory to their client (as a JSON attribute)
function Inventory.sync(o)
	if o.IsBot then
		return
	end
	local inv = o.Inv
	o.Player:SetAttribute("Inv", HttpService:JSONEncode({ S = inv.Slots, E = inv.Eq, A = inv.Ammo, M = inv.Mats, MS = inv.MatSel }))
end

local function shoulder(char: Model): Motor6D?
	local ua = char:FindFirstChild("RightUpperArm")
	local m = ua and ua:FindFirstChild("RightShoulder")
	if m and m:IsA("Motor6D") then
		if not m:GetAttribute("BaseC0") then
			m:SetAttribute("BaseC0", m.C0)
		end
		return m
	end
	return nil
end

local function setAimPose(char: Model, on: boolean)
	local m = shoulder(char)
	if m then
		local base: CFrame = m:GetAttribute("BaseC0")
		m.C0 = on and base * CFrame.Angles(math.rad(90), 0, 0) or base
	end
end

function Inventory.swingPose(char: Model)
	local m = shoulder(char)
	if m then
		local base: CFrame = m:GetAttribute("BaseC0")
		local up = TweenService:Create(m, TweenInfo.new(0.12), { C0 = base * CFrame.Angles(math.rad(150), 0, 0) })
		up:Play()
		up.Completed:Once(function()
			TweenService:Create(m, TweenInfo.new(0.15), { C0 = base }):Play()
		end)
	end
end

-- rebuild the visible weapon/pickaxe/consumable model in the character's right hand
function Inventory.updateHeld(o)
	local char = getChar(o)
	if not char then
		return
	end
	local old = char:FindFirstChild("HeldItem")
	if old then
		old:Destroy()
	end
	local hand = (char:FindFirstChild("RightHand") or char:FindFirstChild("Right Arm")) :: BasePart?
	if not hand then
		return
	end
	local r15 = hand.Name == "RightHand"
	local item = o.Inv.Slots[o.Inv.Eq]
	setAimPose(char, false)
	if not item then
		return
	end
	local m = Instance.new("Model")
	m.Name = "HeldItem"
	local main: BasePart
	local grip: CFrame
	local w = C.Weapons[item.Id]
	if w then
		main = P(m, Vector3.new(0.35, 0.5, w.Len), CFrame.new(), w.Color, Enum.Material.Metal, false)
		local stripe = P(m, Vector3.new(0.38, 0.14, w.Len * 0.6), CFrame.new(), C.Rarities[item.R or 1].Color, Enum.Material.Neon, false)
		weld(main, stripe, CFrame.new(0, 0.12, 0))
		local handle = P(m, Vector3.new(0.3, 0.7, 0.4), CFrame.new(), w.Color, Enum.Material.Metal, false)
		weld(main, handle, CFrame.new(0, -0.45, w.Len * 0.2))
		local mz = Instance.new("Attachment")
		mz.Name = "Muzzle"
		mz.Position = Vector3.new(0, 0.1, -w.Len / 2)
		mz.Parent = main
		if r15 then
			setAimPose(char, true)
			grip = CFrame.new(0, -w.Len / 2 + 0.3, -0.25) * CFrame.Angles(math.rad(-90), 0, 0)
		else
			grip = CFrame.new(0, -1, -w.Len / 2 + 0.3)
		end
	elseif item.Id == "Pickaxe" then
		main = P(m, Vector3.new(0.3, 0.3, 4), CFrame.new(), Color3.fromRGB(90, 60, 40), Enum.Material.Wood, false)
		local head = P(m, Vector3.new(0.4, 2.4, 0.5), CFrame.new(), Color3.fromRGB(200, 80, 255), Enum.Material.Neon, false)
		weld(main, head, CFrame.new(0, 0, -1.9))
		grip = CFrame.new(0, -0.3, -1.2) * CFrame.Angles(math.rad(40), 0, 0)
	else
		local cd = C.Consumables[item.Id]
		main = P(m, Vector3.new(0.8, 1, 0.8), CFrame.new(), cd and cd.Color or Color3.new(1, 1, 1), Enum.Material.Neon, false)
		grip = CFrame.new(0, -0.6, -0.4)
	end
	for _, d in m:GetDescendants() do
		if d:IsA("BasePart") then
			d.CanCollide = false
			d.CanQuery = false
			d.CanTouch = false
			d.Massless = true
		end
	end
	m.PrimaryPart = main
	weld(hand, main, grip)
	m.Parent = char
end

function Inventory.giveAmmo(o, typ: string, n: number)
	if o.Inv.Ammo[typ] then
		o.Inv.Ammo[typ] = math.min(999, o.Inv.Ammo[typ] + n)
	end
end

function Inventory.giveMat(o, mat: string, n: number)
	if o.Inv.Mats[mat] then
		o.Inv.Mats[mat] = math.min(C.MAT_MAX, o.Inv.Mats[mat] + n)
	end
end

-- returns true when the whole item fit into the inventory (stacks consumables)
function Inventory.addItem(o, item): boolean
	local inv = o.Inv
	local cd = C.Consumables[item.Id]
	if cd then
		for i = 2, C.SLOTS do
			local s = inv.Slots[i]
			if s and s.Id == item.Id and s.N < cd.Stack then
				local add = math.min(cd.Stack - s.N, item.N)
				s.N += add
				item.N -= add
				if item.N <= 0 then
					return true
				end
			end
		end
	end
	for i = 2, C.SLOTS do
		if not inv.Slots[i] then
			inv.Slots[i] = item
			return true
		end
	end
	return false
end

function Inventory.hasFreeSlot(o): boolean
	for i = 2, C.SLOTS do
		if not o.Inv.Slots[i] then
			return true
		end
	end
	return false
end

return Inventory
