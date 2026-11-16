function parseDuration(s) {
  const m = /^(\d+)\s*([smhd])$/i.exec(s.trim());
  if (!m) return null;
  const ms = Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2].toLowerCase()];
  return ms > 0 && ms <= 28 * 864e5 ? ms : null;
}

module.exports = parseDuration;
