-- Storm: shrinking circle phases (replicated through BRState attributes) and storm damage

local Core = require(script.Parent.Core)
local Combat = require(script.Parent.Combat)
local C, State = Core.C, Core.State

local Storm = {}

function Storm.reset()
	State:SetAttribute("StormC0", Vector2.zero)
	State:SetAttribute("StormC1", Vector2.zero)
	State:SetAttribute("StormR0", C.STORM_START_R)
	State:SetAttribute("StormR1", C.STORM_START_R)
	State:SetAttribute("StormT0", 0)
	State:SetAttribute("StormT1", 0)
	State:SetAttribute("StormPhase", 0)
	State:SetAttribute("StormDmg", 1)
end

-- runs every phase in BRConfig.Storm; stops if the match id changes
function Storm.run(id: number)
	local center, radius = Vector2.zero, C.STORM_START_R
	for i, ph in C.Storm do
		if Core.Match.Id ~= id then
			return
		end
		local maxOff = math.max(0, radius - ph.Radius) * (i == 1 and 0.35 or 0.85)
		local a = math.random() * 6.28
		local nc = center + Vector2.new(math.cos(a), math.sin(a)) * (math.random() * maxOff)
		if nc.Magnitude > 1 and nc.Magnitude + ph.Radius > C.ISLAND_R then
			nc = nc.Unit * math.max(0, C.ISLAND_R - ph.Radius)
		end
		local now = workspace:GetServerTimeNow()
		State:SetAttribute("StormC0", center)
		State:SetAttribute("StormR0", radius)
		State:SetAttribute("StormC1", nc)
		State:SetAttribute("StormR1", ph.Radius)
		State:SetAttribute("StormT0", now + ph.Wait)
		State:SetAttribute("StormT1", now + ph.Wait + ph.Shrink)
		State:SetAttribute("StormPhase", i)
		State:SetAttribute("StormDmg", ph.Dmg)
		while workspace:GetServerTimeNow() < now + ph.Wait + ph.Shrink do
			if Core.Match.Id ~= id then
				return
			end
			task.wait(0.5)
		end
		center, radius = nc, ph.Radius
	end
end

-- once a second, anyone outside the circle loses health (storm ignores shields)
function Storm.damageLoop(id: number)
	while Core.Match.Id == id do
		task.wait(1)
		local c, r = C.StormAt(State, workspace:GetServerTimeNow())
		local dmg = State:GetAttribute("StormDmg") or 1
		for o in Core.Match.Alive do
			local ch = Core.getChar(o)
			local hrp = ch and ch:FindFirstChild("HumanoidRootPart") :: BasePart?
			local active = (o.IsBot and o.Landed) or (not o.IsBot and Core.getMode(o) == "Match")
			if hrp and active and (Vector2.new(hrp.Position.X, hrp.Position.Z) - c).Magnitude > r then
				o.StormT = os.clock()
				Combat.damageOwner(o, dmg, nil, "Storm", true)
			end
		end
	end
end

return Storm
