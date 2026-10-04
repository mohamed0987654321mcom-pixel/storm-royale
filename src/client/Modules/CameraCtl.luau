-- CameraCtl: lobby showcase shot, over-the-shoulder camera, bus camera, spectating

local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")

local Core = require(script.Parent.Core)
local S, plr, cam = Core.S, Core.plr, Core.cam

local CameraCtl = {}

local function findModel(name: string): Model?
	local bots = workspace:FindFirstChild("BR_Bots")
	local m = workspace:FindFirstChild(name) or (bots and bots:FindFirstChild(name))
	if m and m:IsA("Model") then
		local h = m:FindFirstChildOfClass("Humanoid")
		if h and h.Health > 0 then
			return m
		end
	end
	return nil
end

-- your eliminator first, otherwise any player or bot still alive
local function pickSpectate(): Model?
	local m = S.SpectateName ~= "" and findModel(S.SpectateName) or nil
	if m then
		return m
	end
	for _, p in Players:GetPlayers() do
		if p ~= plr and p:GetAttribute("Mode") == "Match" and p.Character then
			local h = p.Character:FindFirstChildOfClass("Humanoid")
			if h and h.Health > 0 then
				return p.Character
			end
		end
	end
	local bots = workspace:FindFirstChild("BR_Bots")
	if bots then
		for _, b in bots:GetChildren() do
			local h = b:FindFirstChildOfClass("Humanoid")
			if h and h.Health > 0 and b:IsA("Model") then
				return b
			end
		end
	end
	return nil
end

local function freeCursor()
	UIS.MouseBehavior = Enum.MouseBehavior.Default
	UIS.MouseIconEnabled = true
end

function CameraCtl.update()
	local m = S.Mode
	if m == "Menu" then
		cam.CameraType = Enum.CameraType.Scriptable
		local pad = plr:GetAttribute("PadPos")
		if typeof(pad) == "Vector3" then
			cam.CFrame = CFrame.lookAt(pad + Vector3.new(-4.5, 4.4, -15), pad + Vector3.new(-4.5, 3.3, 0))
		end
		cam.FieldOfView = 50
		freeCursor()
		return
	end
	if cam.CameraType ~= Enum.CameraType.Custom then
		cam.CameraType = Enum.CameraType.Custom
	end
	if m == "Bus" then
		local bus = workspace:FindFirstChild("SkyBus")
		local body = bus and bus:FindFirstChild("Body")
		if body and body:IsA("BasePart") and cam.CameraSubject ~= body then
			cam.CameraSubject = body
		end
		plr.CameraMinZoomDistance, plr.CameraMaxZoomDistance = 55, 75
		cam.FieldOfView = 70
		freeCursor()
		return
	end
	if m == "Dead" then
		local sp = S.Spectate
		if not sp or not sp.Parent or not findModel(sp.Name) then
			sp = pickSpectate()
			S.Spectate = sp
		end
		local sh = sp and sp:FindFirstChildOfClass("Humanoid")
		if sh and cam.CameraSubject ~= sh then
			cam.CameraSubject = sh
		end
		plr.CameraMinZoomDistance, plr.CameraMaxZoomDistance = 12, 20
		freeCursor()
		return
	end
	S.Spectate = nil
	local ch, hum, hrp = Core.myChar()
	if not ch or not hum or not hrp then
		return
	end
	if cam.CameraSubject ~= hum then
		cam.CameraSubject = hum
	end
	if ch:GetAttribute("Drop") ~= nil then
		plr.CameraMinZoomDistance, plr.CameraMaxZoomDistance = 18, 22
		hum.CameraOffset = Vector3.zero
		cam.FieldOfView = 75
	else
		-- over-the-shoulder: fixed distance, character faces where the camera looks
		local zoom = S.ADS and 5 or 10
		plr.CameraMinZoomDistance, plr.CameraMaxZoomDistance = zoom, zoom
		hum.CameraOffset = S.ADS and Vector3.new(1.6, 0.9, 0) or Vector3.new(2.4, 0.9, 0)
		hum.AutoRotate = false
		local lv = cam.CFrame.LookVector
		local flat = Vector3.new(lv.X, 0, lv.Z)
		if flat.Magnitude > 0.01 then
			hrp.CFrame = CFrame.lookAt(hrp.Position, hrp.Position + flat.Unit)
		end
		local it = Core.equipped()
		local fov = 72
		if S.ADS then
			fov = (it and it.Id == "Sniper") and 20 or 55
		elseif S.Sprint and hum.MoveDirection.Magnitude > 0.1 then
			fov = 80
		end
		cam.FieldOfView += (fov - cam.FieldOfView) * 0.3
		local speed = 20
		if S.Using then
			speed = 10
		elseif S.ADS then
			speed = 13
		elseif S.Sprint then
			speed = 28
		end
		hum.WalkSpeed = speed
	end
	if not Core.TOUCH then
		local free = S.MapOpen or S.Overlay
		UIS.MouseBehavior = free and Enum.MouseBehavior.Default or Enum.MouseBehavior.LockCenter
		UIS.MouseIconEnabled = free
	end
end

return CameraCtl
