// Parent verification provider (Phase 2).
// Epic's Kids Web Services (KWS) will plug in here once its developer account + API details are set up:
//   startParentVerification() sends the parent to KWS to prove they're an adult/parent,
//   and KWS's webhook (handled in server.js once added) marks the child's consent as 'verified'.
// Until then available() is false: parents can approve the account (play with approved friends),
// but chat and voice for kids stay off.

function available() {
  return Boolean(process.env.KWS_CLIENT_ID && process.env.KWS_CLIENT_SECRET && process.env.KWS_ENABLED === '1');
}

async function startParentVerification() {
  throw new Error('KWS parent verification is not connected yet');
}

module.exports = { available, startParentVerification };
