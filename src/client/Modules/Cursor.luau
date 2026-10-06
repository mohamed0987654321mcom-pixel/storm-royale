-- Cursor: the Storm Royale mouse cursor (a glowing ring + dot), drawn with UI so no image upload is needed.
-- Grows and turns yellow over buttons, squishes when you click, and shows spin arrows in the MY STYLE 3D studio.
-- Other code says whether a cursor should show at all with S.ShowCursor; this module decides how.
-- On touch screens and gamepads it stays out of the way (Roblox's own pointer is used there).

local RunService = game:GetService("RunService")
local UIS = game:GetService("UserInputService")
local GuiService = game:GetService("GuiService")
local TweenService = game:GetService("TweenService")

local Core = require(script.Parent.Core)
local S, plr = Core.S, Core.plr
local new, text = Core.new, Core.text
local WHITE, YELLOW, FONT_B = Core.WHITE, Core.YELLOW, Core.FONT_B

local Cursor = {}

local playerGui = plr:WaitForChild("PlayerGui")
local mouse = plr:GetMouse()

local gui = new("ScreenGui", { Name = "StormCursor", ResetOnSpawn = false, IgnoreGuiInset = true, DisplayOrder = 1000, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, playerGui)
local root = new("Frame", { Size = UDim2.fromOffset(0, 0), BackgroundTransparency = 1, Visible = false, Interactable = false }, gui)
local scale = new("UIScale", { Scale = 1 }, root)

local function circle(size: number, parent: Instance): Frame
	local f = new("Frame", { Size = UDim2.fromOffset(size, size), AnchorPoint = Vector2.new(0.5, 0.5), BackgroundTransparency = 1, BorderSizePixel = 0 }, parent)
	new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, f)
	return f
end

-- soft dark outline so the cursor shows on bright skies too
local shadow = circle(30, root)
local shadowStroke = new("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = 4, Transparency = 0.65 }, shadow)
local ring = circle(26, root)
ring.BackgroundColor3 = YELLOW
local ringStroke = new("UIStroke", { Color = WHITE, Thickness = 2.5, Transparency = 0.05 }, ring)
local dot = circle(7, root)
dot.BackgroundTransparency = 0
dot.BackgroundColor3 = YELLOW
new("UIStroke", { Color = Color3.fromRGB(60, 40, 0), Thickness = 1, Transparency = 0.3 }, dot)
-- MY STYLE studio: little arrows saying "drag to spin"
local spinHint = text(root, "‹   ›", UDim2.fromOffset(60, 20), UDim2.fromOffset(-30, -10), FONT_B, 18, WHITE)
spinHint.Visible = false

local hovering = false
local pressed = false
local curSize = 26

local function overButton(): boolean
	local ok, list = pcall(playerGui.GetGuiObjectsAtPosition, playerGui, mouse.X, mouse.Y)
	if not ok then
		return false
	end
	for _, g in list do
		if g:IsA("GuiButton") and g.Visible and g.Active and g ~= root then
			return true
		end
	end
	return false
end

local function usingMouse(): boolean
	if not UIS.MouseEnabled then
		return false
	end
	local last = UIS:GetLastInputType()
	return last ~= Enum.UserInputType.Touch and not string.find(last.Name, "Gamepad")
end

UIS.InputBegan:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		pressed = true
		TweenService:Create(scale, TweenInfo.new(0.06), { Scale = 0.78 }):Play()
	end
end)
UIS.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		pressed = false
		TweenService:Create(scale, TweenInfo.new(0.18, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	end
end)

local frame = 0
function Cursor.start()
	RunService:BindToRenderStep("StormCursor", Enum.RenderPriority.Last.Value, function(dt)
		local want = S.ShowCursor ~= false
		local mine = want and usingMouse() and not GuiService.MenuIsOpen
		-- our cursor replaces Roblox's arrow only while it's drawn; Roblox's menu always gets the normal arrow
		UIS.MouseIconEnabled = GuiService.MenuIsOpen or (want and not mine)
		root.Visible = mine
		if not mine then
			return
		end
		local pos = UIS:GetMouseLocation()
		root.Position = UDim2.fromOffset(pos.X, pos.Y)

		frame += 1
		if frame % 2 == 0 then
			hovering = overButton()
		end
		local studio = S.Studio and S.Studio.On and not hovering
		local target = hovering and 36 or (studio and 32 or 26)
		curSize += (target - curSize) * math.min(1, dt * 18)
		ring.Size = UDim2.fromOffset(curSize, curSize)
		shadow.Size = UDim2.fromOffset(curSize + 4, curSize + 4)
		ring.BackgroundTransparency = (hovering or (studio and pressed)) and 0.78 or 1
		ringStroke.Color = (hovering or studio) and YELLOW or WHITE
		shadowStroke.Transparency = hovering and 0.5 or 0.65
		dot.Visible = not studio
		spinHint.Visible = studio
		spinHint.TextColor3 = pressed and YELLOW or WHITE
	end)
end

return Cursor
