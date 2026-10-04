-- Build: picks the grid cell you're aiming at, shows the blue preview, sends placements

local Core = require(script.Parent.Core)
local C, Net, S, cam = Core.C, Core.Net, Core.S, Core.cam
local new = Core.new

local Build = {}

local Ghost = new("Model", { Name = "BuildGhost" }, nil)
table.insert(Core.ignore, Ghost)
local ghostParts: { [string]: BasePart } = {}

-- mirrors the server grid in BRConfig.Piece
local function computePiece(): (string?, number, number, number, number)
	local _, _, hrp = Core.myChar()
	if not hrp then
		return nil, 0, 0, 0, 1
	end
	local G = C.GRID
	local look = cam.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	flat = flat.Magnitude > 0.01 and flat.Unit or hrp.CFrame.LookVector
	local dir = (math.abs(flat.X) > math.abs(flat.Z)) and (flat.X > 0 and 1 or 3) or (flat.Z > 0 and 2 or 4)
	local pitch = math.deg(math.asin(math.clamp(look.Y, -1, 1)))
	local feet = hrp.Position.Y - 3
	local cx, cz = math.floor(hrp.Position.X / G), math.floor(hrp.Position.Z / G)
	local ly = math.floor((feet + 1) / G)
	local step = C.Dirs[dir]
	local fx, fz = cx + step.X, cz + step.Z
	local piece = S.Piece
	if piece == "Wall" then
		return piece, cx, ly + (pitch > 35 and 1 or 0), cz, dir
	elseif piece == "Floor" then
		if pitch < -40 then
			return piece, cx, ly, cz, dir
		end
		return piece, fx, ly + (pitch > 30 and 1 or 0), fz, dir
	elseif piece == "Ramp" then
		-- standing on a ramp? the next one goes one level up (ramp rushing)
		local down = workspace:Raycast(hrp.Position, Vector3.new(0, -6, 0), Core.rayParams())
		if down and down.Instance.Parent and down.Instance.Parent.Name == "Build_Ramp" then
			ly = math.floor(down.Instance.Position.Y / G) + 1
		end
		return piece, fx, ly, fz, ((dir - 1 + S.Rot) % 4) + 1
	else
		if pitch > 25 then
			return piece, cx, ly + 1, cz, dir
		end
		return piece, fx, ly + 1, fz, dir
	end
end

function Build.updateGhost()
	if not S.Building or not Core.inGame() then
		Ghost.Parent = nil
		S.GhostArgs = nil
		return
	end
	local piece, cx, ly, cz, dir = computePiece()
	if not piece then
		Ghost.Parent = nil
		S.GhostArgs = nil
		return
	end
	local key, specs = C.Piece(piece, cx, ly, cz, dir)
	for _, gp in ghostParts do
		gp.Transparency = 1
	end
	for i, spec in specs do
		local id = (spec[3] and "W" or "P") .. i
		local gp = ghostParts[id]
		if not gp then
			gp = new(spec[3] and "WedgePart" or "Part", { Anchored = true, CanCollide = false, CanQuery = false, CanTouch = false, CastShadow = false, Material = Enum.Material.Neon, Color = Color3.fromRGB(80, 170, 255) }, Ghost)
			ghostParts[id] = gp
		end
		gp.Size = spec[2]
		gp.CFrame = spec[1]
		gp.Transparency = 0.6
	end
	Ghost.Parent = workspace
	S.GhostArgs = { piece, cx, ly, cz, dir, key }
end

function Build.tryBuild()
	local a = S.GhostArgs
	if not a then
		return
	end
	local now = os.clock()
	if (a[6] == S.LastBuildKey and now - S.LastBuild < 0.4) or now - S.LastBuild < 0.08 then
		return
	end
	S.LastBuild = now
	S.LastBuildKey = a[6]
	Net:FireServer("Build", a[1], a[2], a[3], a[4], a[5])
end

return Build
