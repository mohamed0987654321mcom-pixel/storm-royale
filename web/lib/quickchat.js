// Quick chat: fixed, friendly game phrases. Nothing can be typed, so nothing personal can be shared.
// Kids can use these once a parent approves their account, even before the parent is verified.
const PHRASES = [
  { id: 'hi', text: 'Hi! 👋' },
  { id: 'gg', text: 'GG! 🎉' },
  { id: 'nice', text: 'Nice shot! 🎯' },
  { id: 'follow', text: 'Follow me! 🏃' },
  { id: 'wait', text: 'Wait for me! ⏳' },
  { id: 'ready', text: 'Ready! ✅' },
  { id: 'drop', text: "Let's drop here! 📍" },
  { id: 'enemy', text: 'Enemy spotted! 👀' },
  { id: 'watch', text: 'Watch out! ⚠️' },
  { id: 'heal', text: 'I need healing! 🩹' },
  { id: 'ammo', text: 'I need ammo! 🔫' },
  { id: 'loot', text: 'Loot over here! 💰' },
  { id: 'build', text: 'Building! 🧱' },
  { id: 'storm', text: 'Storm is coming! 🌪️' },
  { id: 'thanks', text: 'Thanks! 🙏' },
  { id: 'luck', text: 'Good luck! 🍀' },
  { id: 'oops', text: 'Oops! 😅' },
  { id: 'haha', text: 'Haha! 😂' },
  { id: 'again', text: 'One more game? 🔁' },
  { id: 'bye', text: 'Bye! 👋' },
];

const byId = new Map(PHRASES.map((p) => [p.id, p]));

module.exports = { PHRASES, byId };
