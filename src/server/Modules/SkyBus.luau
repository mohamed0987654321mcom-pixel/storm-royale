-- SkyBus: the flying bus that carries everyone across the island

local RunService = game:GetService("RunService")

local Core = require(script.Parent.Core)
local Bots = require(script.Parent.Bots)
local C, State, P = Core.C, Core.State, Core.P

local SkyBus = {}

local function makeBus(): Model
	local m = Instance.new("Model")
	m.Name = "SkyBus"
	local body = P(m, Vector3.new(14, 11, 34), CFrame.new(), Color3.fromRGB(40, 120, 230))
	body.Name = "Body"
	P(m, Vector3.new(14.2, 2, 34.2), CFrame.new(0, -2.5, 0), Color3.new(1, 1, 1))
	P(m, Vector3.new(14.3, 3, 26), CFrame.new(0, 2, 2), Color3.fromRGB(30, 40, 60), Enum.Material.Glass)
	P(m, Vector3.new(12, 4, 0.4), CFrame.new(0, 2, -17.1), Color3.fromRGB(30, 40, 60), Enum.Material.Glass)
	P(m, Vector3.new(44, 1, 9), CFrame.new(0, 0, 3), Color3.new(1, 1, 1))
	for _, x in { -6, 6 } do
		local th = P(m, Vector3.new(4, 4, 8), CFrame.new(x, -7, 8), Color3.fromRGB(255, 140, 30), Enum.Material.Neon)
		local fire = Instance.new("Fire")
		fire.Size = 8
		fire.Heat = -15
		fire.Parent = th
	end
	for _, p in m:GetDescendants() do
		if p:IsA("BasePart") then
			p.CanCollide = false
			p.CanQuery = false
		end
	end
	m.PrimaryPart = body
	m.Parent = workspace
	return m
end

function SkyBus.jump(o)
	local plr = o.Player
	if plr:GetAttribute("Mode") ~= "Bus" then
		return
	end
	plr:SetAttribute("Mode", "Match")
	local ch = plr.Character
	local hrp = ch and ch:FindFirstChild("HumanoidRootPart") :: BasePart?
	if ch and hrp then
		ch:SetAttribute("Drop", "Sky")
		hrp.CFrame = Core.Match.BusCF * CFrame.new(0, -12, 0)
		hrp.Anchored = false
		pcall(function()
			hrp:SetNetworkOwner(plr)
		end)
	end
end

-- flies the bus across a random line; players jump themselves, bots jump at random times
function SkyBus.run(parts, bots)
	local Match = Core.Match
	local th = math.random() * math.pi * 2
	local dir = Vector3.new(math.cos(th), 0, math.sin(th))
	local perp = Vector3.new(-dir.Z, 0, dir.X) * math.random(-250, 250)
	local up = Vector3.new(0, C.BUS_HEIGHT, 0)
	local A, B = -dir * C.BUS_HALF + perp + up, dir * C.BUS_HALF + perp + up
	local t0 = workspace:GetServerTimeNow()
	State:SetAttribute("BusA", A)
	State:SetAttribute("BusB", B)
	State:SetAttribute("BusT0", t0)
	State:SetAttribute("BusT1", t0 + C.BUS_TIME)
	local bus = makeBus()
	Match.Bus = bus
	Match.DoorsOpen = false
	State:SetAttribute("Phase", "Bus")
	for _, b in bots do
		b.JumpAt = math.random(C.BUS_DOORS + 1, C.BUS_TIME - 3) + math.random()
	end
	local start = os.clock()
	local conn = RunService.Heartbeat:Connect(function()
		local pos = A:Lerp(B, math.clamp((os.clock() - start) / C.BUS_TIME, 0, 1))
		local cf = CFrame.lookAt(pos, pos + dir)
		bus:PivotTo(cf)
		Match.BusCF = cf
		for _, o in parts do
			if o.Player:GetAttribute("Mode") == "Bus" then
				local ch = o.Player.Character
				local hrp = ch and ch:FindFirstChild("HumanoidRootPart") :: BasePart?
				if hrp then
					hrp.Anchored = true
					hrp.CFrame = cf * CFrame.new(0, 0, 4)
				end
			end
		end
	end)
	while os.clock() - start < C.BUS_TIME do
		local el = os.clock() - start
		if el >= C.BUS_DOORS and not Match.DoorsOpen then
			Match.DoorsOpen = true
			State:SetAttribute("Doors", true)
		end
		for _, b in bots do
			if not b.Jumped and el >= b.JumpAt then
				b.Jumped = true
				task.spawn(Bots.drop, b, Match.BusCF.Position - Vector3.new(0, 10, 0))
			end
		end
		task.wait(0.1)
	end
	-- end of the line: everyone out
	for _, o in parts do
		SkyBus.jump(o)
	end
	for _, b in bots do
		if not b.Jumped then
			b.Jumped = true
			task.spawn(Bots.drop, b, Match.BusCF.Position - Vector3.new(0, 10, 0))
		end
	end
	conn:Disconnect()
	bus:Destroy()
	Match.Bus = nil
	Match.DoorsOpen = false
	State:SetAttribute("Doors", false)
end

return SkyBus
