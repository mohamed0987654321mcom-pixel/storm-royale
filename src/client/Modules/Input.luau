-- Input: keyboard/mouse bindings and on-screen touch buttons

local UIS = game:GetService("UserInputService")

local Core = require(script.Parent.Core)
local Hud = require(script.Parent.Hud)
local Skydive = require(script.Parent.Skydive)
local C, Net, S = Core.C, Core.Net, Core.S
local new, corner, button = Core.new, Core.corner, Core.button
local WHITE = Core.WHITE

local Input = {}

local pieceByKey = {
	[Enum.KeyCode.Z] = "Wall",
	[Enum.KeyCode.F1] = "Wall",
	[Enum.KeyCode.X] = "Floor",
	[Enum.KeyCode.F2] = "Floor",
	[Enum.KeyCode.C] = "Ramp",
	[Enum.KeyCode.F3] = "Ramp",
	[Enum.KeyCode.V] = "Roof",
	[Enum.KeyCode.F4] = "Roof",
}
local slotByKey = { [Enum.KeyCode.One] = 1, [Enum.KeyCode.Two] = 2, [Enum.KeyCode.Three] = 3, [Enum.KeyCode.Four] = 4, [Enum.KeyCode.Five] = 5, [Enum.KeyCode.Six] = 6 }

local function equipSlot(i: number)
	S.Building = false
	if S.Inv then
		S.Inv.E = i
	end
	Net:FireServer("Equip", i)
	Hud.refreshInv()
end

local function toggleBuild()
	S.Building = not S.Building
	S.ADS = false
	Hud.refreshInv()
end

local function cycleMat()
	if S.Inv then
		Net:FireServer("Mat", (S.Inv.MS % 3) + 1)
	end
end

local function rotateOrReload()
	if S.Building then
		S.Rot = (S.Rot + 1) % 4
	else
		Net:FireServer("Reload")
	end
end

local function onBegan(input: InputObject, gp: boolean)
	if gp then
		return
	end
	local kc = input.KeyCode
	local t = input.UserInputType
	if t == Enum.UserInputType.MouseButton1 then
		if Core.inGame() and not S.MapOpen and not S.Overlay then
			S.Firing = true
		end
	elseif t == Enum.UserInputType.MouseButton2 then
		if Core.inGame() and not S.Building then
			S.ADS = true
		end
	elseif kc == Enum.KeyCode.M then
		if S.Mode ~= "Menu" then
			Hud.setMapOpen(not S.MapOpen)
		end
	elseif kc == Enum.KeyCode.B then
		Net:FireServer("Thanks")
	elseif kc == Enum.KeyCode.L then
		if S.Mode == "Warmup" then
			Net:FireServer("Menu")
		end
	elseif not Core.inGame() then
		return
	elseif kc == Enum.KeyCode.Q then
		toggleBuild()
	elseif pieceByKey[kc] then
		S.Building = true
		S.ADS = false
		S.Piece = pieceByKey[kc]
		Hud.refreshInv()
	elseif kc == Enum.KeyCode.G then
		cycleMat()
	elseif kc == Enum.KeyCode.R then
		rotateOrReload()
	elseif slotByKey[kc] then
		equipSlot(slotByKey[kc])
	elseif kc == Enum.KeyCode.LeftShift then
		S.Sprint = true
	end
end

local function onEnded(input: InputObject)
	local t = input.UserInputType
	if t == Enum.UserInputType.MouseButton1 then
		S.Firing = false
	elseif t == Enum.UserInputType.MouseButton2 then
		S.ADS = false
	elseif input.KeyCode == Enum.KeyCode.LeftShift then
		S.Sprint = false
	end
end

local function onChanged(input: InputObject, gp: boolean)
	if gp or input.UserInputType ~= Enum.UserInputType.MouseWheel or not Core.inGame() or not S.Inv or S.MapOpen then
		return
	end
	local step = input.Position.Z > 0 and -1 or 1
	equipSlot(((S.Inv.E - 1 + step) % C.SLOTS) + 1)
end

local function touchButtons()
	local UI = Hud.UI
	local mb = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1 }, Hud.HUD)
	local function round(str: string, pos: UDim2, size: number, color: Color3): any
		local b = button(mb, str, UDim2.new(0, size, 0, size), pos, color, WHITE, size * 0.32)
		corner(b, size // 2)
		b.BackgroundTransparency = 0.25
		return b
	end
	local fire = round("FIRE", UDim2.new(1, -230, 1, -320), 100, Color3.fromRGB(220, 60, 60))
	fire.InputBegan:Connect(function(i)
		if i.UserInputType == Enum.UserInputType.Touch then
			S.Firing = true
		end
	end)
	fire.InputEnded:Connect(function(i)
		if i.UserInputType == Enum.UserInputType.Touch then
			S.Firing = false
		end
	end)
	round("AIM", UDim2.new(1, -330, 1, -260), 70, Color3.fromRGB(60, 60, 80)).MouseButton1Click:Connect(function()
		S.ADS = not S.ADS
	end)
	round("BUILD", UDim2.new(1, -120, 1, -420), 76, Color3.fromRGB(30, 90, 200)).MouseButton1Click:Connect(toggleBuild)
	round("⟳", UDim2.new(1, -330, 1, -170), 64, Color3.fromRGB(60, 60, 80)).MouseButton1Click:Connect(rotateOrReload)
	round("MAT", UDim2.new(1, -210, 1, -420), 64, Color3.fromRGB(150, 100, 50)).MouseButton1Click:Connect(cycleMat)
	button(UI.MapGroup, "MAP", UDim2.new(0, 70, 0, 34), UDim2.new(1, -300, 0, 20), Color3.fromRGB(20, 40, 110), WHITE, 18).MouseButton1Click:Connect(function()
		Hud.setMapOpen(not S.MapOpen)
	end)
	UI.ThanksBtn = button(UI.MapGroup, "THANK DRIVER", UDim2.new(0, 150, 0, 40), UDim2.new(0.5, -75, 0, 140), Color3.fromRGB(20, 40, 110), WHITE, 18)
	UI.ThanksBtn.MouseButton1Click:Connect(function()
		Net:FireServer("Thanks")
	end)
end

function Input.start()
	UIS.InputBegan:Connect(onBegan)
	UIS.InputEnded:Connect(onEnded)
	UIS.InputChanged:Connect(onChanged)
	UIS.JumpRequest:Connect(Skydive.onJumpRequest)
	if Core.TOUCH then
		touchButtons()
	end
end

return Input
