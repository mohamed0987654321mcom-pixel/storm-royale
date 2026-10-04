-- Skydive: steering after you jump out of the bus, gliding and landing

local Core = require(script.Parent.Core)
local C, Net, S, cam = Core.C, Core.Net, Core.S, Core.cam

local Skydive = {}

-- Roblox's control module, looked up without ever waiting (some Studio setups don't have it)
local Controls = nil
local controlsLoaded = false
local function getControls()
	if controlsLoaded then
		return Controls
	end
	local ps = Core.plr:FindFirstChild("PlayerScripts")
	local pm = ps and ps:FindFirstChild("PlayerModule")
	if pm and pm:IsA("ModuleScript") then
		controlsLoaded = true
		local ok, res = pcall(function()
			return (require(pm) :: any):GetControls()
		end)
		if ok then
			Controls = res
		end
	end
	return Controls
end

function Skydive.groundDist(hrp: BasePart): number
	local r = workspace:Raycast(hrp.Position, Vector3.new(0, -3000, 0), Core.rayParams())
	return r and (hrp.Position.Y - r.Position.Y) or 9999
end

-- returns true while dropping (so shooting/building stay off)
function Skydive.update(): boolean
	local ch, hum, hrp = Core.myChar()
	if not ch or not hum or not hrp then
		return false
	end
	local drop = ch:GetAttribute("Drop")
	if not drop then
		if hum.PlatformStand then
			hum.PlatformStand = false
		end
		S.GlideSent, S.LandSent = false, false
		return false
	end
	if S.LandSent then
		return true
	end
	hum.PlatformStand = true
	local look = cam.CFrame.LookVector
	local fwd = Vector3.new(look.X, 0, look.Z)
	fwd = fwd.Magnitude > 0.01 and fwd.Unit or Vector3.new(0, 0, -1)
	local right = Vector3.new(-fwd.Z, 0, fwd.X)
	local mv
	local controls = getControls()
	if controls then
		local v = controls:GetMoveVector()
		mv = right * v.X + fwd * -v.Z
	else
		-- fallback: the direction your movement keys/thumbstick are pushing
		mv = Vector3.new(hum.MoveDirection.X, 0, hum.MoveDirection.Z)
	end
	local h = Skydive.groundDist(hrp)
	local vel, pitch
	if drop == "Sky" then
		if h < C.GLIDE_AUTO and not S.GlideSent then
			S.GlideSent = true
			Net:FireServer("Glide")
		end
		local diving = mv:Dot(fwd) > 0.5
		vel = mv * 55 + Vector3.new(0, -(diving and C.SKYDIVE_SPEED * 1.25 or C.SKYDIVE_SPEED), 0)
		pitch = diving and -80 or -60
	else
		vel = mv * 48 + fwd * 8 + Vector3.new(0, -C.GLIDE_SPEED, 0)
		pitch = -10
	end
	hrp.AssemblyLinearVelocity = vel
	hrp.AssemblyAngularVelocity = Vector3.zero
	hrp.CFrame = CFrame.lookAt(hrp.Position, hrp.Position + fwd) * CFrame.Angles(math.rad(pitch), 0, 0)
	if h < 6 then
		S.LandSent = true
		hum.PlatformStand = false
		hrp.CFrame = CFrame.lookAt(hrp.Position, hrp.Position + fwd)
		hrp.AssemblyLinearVelocity = Vector3.zero
		Net:FireServer("Landed")
	end
	return true
end

-- Space / mobile jump: leave the bus, or open the glider early
function Skydive.onJumpRequest()
	local now = os.clock()
	if now - S.LastJumpReq < 0.4 then
		return
	end
	S.LastJumpReq = now
	if S.Mode == "Bus" then
		if Core.State:GetAttribute("Doors") then
			Net:FireServer("JumpBus")
		end
		return
	end
	local ch, _, hrp = Core.myChar()
	if ch and hrp and ch:GetAttribute("Drop") == "Sky" and not S.GlideSent and Skydive.groundDist(hrp) < 350 then
		S.GlideSent = true
		Net:FireServer("Glide")
	end
end

return Skydive
