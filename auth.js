const jwt = require("jsonwebtoken");
const SECRET_KEY = "yht"; // 替换为更复杂的密钥

/**
 * 生成 Token
 * @param {Object} payload - 要放入 Token 的数据
 * @param {String} expiresIn - Token 有效期 (如 "1h", "7d")
 * @returns {String} - 生成的 Token
 */
function generateToken(payload, expiresIn = "7d") {
  return jwt.sign(payload, SECRET_KEY, { expiresIn });
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    console.log("Decoded Payload:", decoded);
    return decoded["id"];
  } catch (error) {
    console.error("Invalid Token:", error.message);
    return null;
  }
}

module.exports = { generateToken, verifyToken };
