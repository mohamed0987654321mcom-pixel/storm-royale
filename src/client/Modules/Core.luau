-- Core (client): services, shared state, UI helpers and character helpers

local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local UIS = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local Core = {}

Core.plr = Players.LocalPlayer
Core.cam = workspace.CurrentCamera
Core.C = require(RS:WaitForChild("Shared"):WaitForChild("BRConfig"))
Core.Net = RS:WaitForChild("BRNet") :: RemoteEvent
Core.State = RS:WaitForChild("BRState")

Core.TOUCH = UIS.TouchEnabled and not UIS.KeyboardEnabled
Core.FONT_H = Enum.Font.LuckiestGuy
Core.FONT_B = Enum.Font.GothamBlack
Core.FONT_M = Enum.Font.GothamBold
Core.WHITE = Color3.new(1, 1, 1)
Core.YELLOW = Color3.fromRGB(255, 220, 50)

-- everything the client needs to remember between frames
Core.S = {
	Mode = "Menu",
	Inv = nil :: any,
	Data = nil :: any,
	Building = false,
	Piece = "Wall",
	Rot = 0,
	ADS = false,
	Firing = false,
	Sprint = false,
	MapOpen = false,
	LastShot = 0,
	LastBuild = 0,
	LastBuildKey = "",
	Using = false,
	GlideSent = false,
	LandSent = false,
	Spectate = nil :: Model?,
	SpectateName = "",
	Overlay = false,
	PoiName = "",
	Bloom = 0,
	LastJumpReq = 0,
	GhostArgs = nil :: any,
	ShrinkSeen = 0,
	ShowCursor = true, -- should a mouse cursor show right now? (the Cursor module draws it)
	-- MY STYLE 3D studio camera (orbit around your character in the lobby)
	Studio = { On = false, Yaw = 0, Pitch = 0.08, Dist = 11, FocusY = 3, Spin = false, BlendUntil = 0, LastT = 0 },
}

-- instances our own raycasts should ignore (effects, previews, lobby backdrop...)
Core.ignore = {} :: { Instance }

-------------------------------------------------------------------------------
-- UI helpers
-------------------------------------------------------------------------------
local WHITE, FONT_B, FONT_H = Core.WHITE, Core.FONT_B, Core.FONT_H

function Core.new(class: string, props: { [string]: any }, parent: Instance?): any
	local o = Instance.new(class)
	for k, v in props do
		(o :: any)[k] = v
	end
	o.Parent = parent
	return o
end
local new = Core.new

function Core.corner(p: Instance, r: number?)
	new("UICorner", { CornerRadius = UDim.new(0, r or 8) }, p)
end

function Core.stroke(p: Instance, color: Color3?, t: number?)
	new("UIStroke", { Color = color or Color3.new(0, 0, 0), Thickness = t or 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, p)
end

function Core.text(parent: Instance, str: string, size: UDim2, pos: UDim2, font: Enum.Font?, ts: number?, color: Color3?, xa: Enum.TextXAlignment?): any
	return new("TextLabel", {
		BackgroundTransparency = 1,
		Text = str,
		Size = size,
		Position = pos,
		Font = font or FONT_B,
		TextSize = ts or 18,
		TextColor3 = color or WHITE,
		TextXAlignment = xa or Enum.TextXAlignment.Center,
		TextStrokeTransparency = 0.6,
	}, parent)
end

function Core.button(parent: Instance, str: string, size: UDim2, pos: UDim2, bg: Color3, fg: Color3?, ts: number?): any
	local b = new("TextButton", {
		Text = str,
		Size = size,
		Position = pos,
		BackgroundColor3 = bg,
		TextColor3 = fg or WHITE,
		Font = FONT_H,
		TextSize = ts or 22,
		AutoButtonColor = true,
		BorderSizePixel = 0,
	}, parent)
	Core.corner(b, 6)
	return b
end

function Core.gradient(p: Instance, a: Color3, b: Color3, rot: number?)
	new("UIGradient", { Color = ColorSequence.new(a, b), Rotation = rot or 90 }, p)
end

function Core.fmtTime(sec: number): string
	sec = math.max(0, math.floor(sec))
	return string.format("%d:%02d", sec // 60, sec % 60)
end

function Core.rarityColor(r: number?): Color3
	return Core.C.Rarities[r or 1].Color
end

Core.gui = new("ScreenGui", { Name = "StormRoyaleUI", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, Core.plr:WaitForChild("PlayerGui"))
local uiScale = new("UIScale", {}, Core.gui)
local function rescale()
	uiScale.Scale = math.clamp(Core.cam.ViewportSize.Y / 900, 0.55, 1.25)
end
rescale()
Core.cam:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)

local Fade = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 1, ZIndex = 50 }, Core.gui)
function Core.fade()
	Fade.BackgroundTransparency = 0
	TweenService:Create(Fade, TweenInfo.new(0.6), { BackgroundTransparency = 1 }):Play()
end

local ToastL = Core.text(Core.gui, "", UDim2.new(0, 700, 0, 34), UDim2.new(0.5, -350, 0.72, 0), FONT_B, 22, WHITE)
ToastL.ZIndex = 40
local toastId = 0
function Core.toast(msg: string)
	toastId += 1
	local id = toastId
	ToastL.Text = msg
	ToastL.TextTransparency = 0
	task.delay(2.5, function()
		if id == toastId then
			TweenService:Create(ToastL, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		end
	end)
end

-------------------------------------------------------------------------------
-- Character / aiming helpers
-------------------------------------------------------------------------------
function Core.myChar(): (Model?, Humanoid?, BasePart?)
	local ch = Core.plr.Character
	local hum = ch and ch:FindFirstChildOfClass("Humanoid")
	local hrp = ch and ch:FindFirstChild("HumanoidRootPart")
	if ch and hum and hrp and hrp:IsA("BasePart") and hum.Health > 0 then
		return ch, hum, hrp
	end
	return nil, nil, nil
end

function Core.inGame(): boolean
	return Core.S.Mode == "Warmup" or Core.S.Mode == "Match"
end

function Core.equipped()
	local inv = Core.S.Inv
	return inv and inv.S[inv.E] or nil
end

function Core.rayParams(): RaycastParams
	local p = RaycastParams.new()
	p.FilterType = Enum.RaycastFilterType.Exclude
	local list: { Instance } = table.clone(Core.ignore)
	for _, n in { "BR_Effects", "BR_Loot", "BR_StormFX", "BR_Menu" } do
		local f = workspace:FindFirstChild(n)
		if f then
			table.insert(list, f)
		end
	end
	if Core.plr.Character then
		table.insert(list, Core.plr.Character)
	end
	p.FilterDescendantsInstances = list
	return p
end

function Core.screenRay(): (Vector3, Vector3)
	local vp = Core.cam.ViewportSize
	local r = Core.cam:ViewportPointToRay(vp.X / 2, vp.Y / 2)
	return r.Origin, r.Direction
end

function Core.spreadDir(dir: Vector3, deg: number): Vector3
	local a = math.random() * math.pi * 2
	local r = math.rad(deg) * math.sqrt(math.random())
	return (CFrame.lookAt(Vector3.zero, dir) * CFrame.Angles(0, 0, a) * CFrame.Angles(r, 0, 0)).LookVector
end

return Core
