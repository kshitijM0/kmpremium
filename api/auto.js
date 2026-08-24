const mapping = require("../lib/auto/mapping");
const providers = require("../lib/auto/providers");
const services = require("../lib/auto/services");

module.exports = async (req, res) => {
  const path = String(
    (req.query && (req.query.route || req.query.resource)) ||
    (req.body && (req.body.route || req.body.resource)) ||
    "providers"
  ).toLowerCase();

  if (path === "mapping") return mapping(req, res);
  if (path === "providers") return providers(req, res);
  if (path === "services") return services(req, res);

  return res.status(400).json({
    success: false,
    error: "Invalid auto resource. Use mapping, providers, or services."
  });
};
