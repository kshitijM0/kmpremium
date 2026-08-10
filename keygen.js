const { randomBytes } = require("crypto");

// Cryptographically secure random key, e.g. KM-9F2A-7D1C-BE44-01AA
function generateKeyValue() {
  const hex = randomBytes(16).toString("hex").toUpperCase();
  const groups = hex.match(/.{1,4}/g) || [];
  return `KM-${groups.join("-")}`;
}

function expiryFromMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

module.exports = { generateKeyValue, expiryFromMinutes };
