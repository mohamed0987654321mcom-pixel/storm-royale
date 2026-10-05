// Strict moderation ladder: every strike makes the next penalty longer.
//   warning  (severity 1)  message hidden; 3 warnings within an hour = 1 strike
//   serious  (severity 2)  1 strike
//   severe   (severity 3)  2 strikes; grooming or sexual content = banned right away until a moderator reviews it
// Strikes 1-4 mute for 15 min, 1 h, 24 h, 3 days; strike 5 bans for 7 days. Admins can lift any of it.
const LADDER_MIN = [15, 60, 24 * 60, 3 * 24 * 60];
const BAN_AT = 5;
const BAN_DAYS = 7;
const WARNINGS_PER_STRIKE = 3;
const WARNING_WINDOW_MS = 60 * 60 * 1000;
const VOICE_MIN_MUTE = 2; // whatever was said out loud already went out, so voice always gets at least a short mute

const strikesFor = (verdict) => (verdict.severity >= 3 ? 2 : verdict.severity === 2 ? 1 : 0);
const instantBan = (verdict) => verdict.severity >= 3 && ['grooming', 'sexual'].includes(verdict.category);

// total strikes -> { muteMin } or { banDays }
function penaltyFor(strikes) {
  if (strikes >= BAN_AT) return { banDays: BAN_DAYS };
  if (strikes <= 0) return {};
  return { muteMin: LADDER_MIN[strikes - 1] };
}

function describe(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (24 * 60));
  return `${days} day${days === 1 ? '' : 's'}`;
}

module.exports = { LADDER_MIN, BAN_AT, BAN_DAYS, WARNINGS_PER_STRIKE, WARNING_WINDOW_MS, VOICE_MIN_MUTE, strikesFor, instantBan, penaltyFor, describe };
