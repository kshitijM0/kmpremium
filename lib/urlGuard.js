// Panel addresses come from customers, so before this server contacts one it must be a normal public web address.
// Blocks localhost, private/internal networks and cloud-metadata addresses (SSRF), credentials in the URL and odd ports.
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

// Returns the parsed URL, or throws an Error with a message that is safe to show to the user.
function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new Error("That panel address is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The panel address must start with http:// or https://");
  if (url.username || url.password) throw new Error("The panel address must not contain a username or password.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("The panel address must use the normal web port.");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new Error("That panel address is not allowed.");
  if (host.includes(":") || host.startsWith("[")) throw new Error("IPv6 addresses are not allowed as a panel address.");
  if (isPrivateIPv4(host)) throw new Error("That panel address is not allowed.");
  if (!host.includes(".")) throw new Error("That panel address is not valid.");
  return url;
}

module.exports = { assertPublicHttpUrl };
