const pool = require("./db");
const crypto = require("crypto");
const algorithm = "aes-256-cbc";
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);
function encryptPhoneNumber(phoneNumber) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(phoneNumber, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encryptedData: encrypted,
    iv: iv.toString("hex"),
  };
}

function decryptPhoneNumber(encryptedData, ivHex) {
  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivHex, "hex")
  );
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function saveMessage(sender_id, receiver_id, content, is_received) {
  //console.log('Pool:', pool);
  const query = `
    INSERT INTO messages (sender_id, receiver_id, content, is_received)
    VALUES (?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    pool.query(
      query,
      [sender_id, receiver_id, content, is_received],
      (err, results) => {
        if (err) {
          console.error("Error saving message to database:", err.message);
          return reject(err);
        }
        resolve(results);
      }
    );
  });
}
module.exports = { encryptPhoneNumber, decryptPhoneNumber, saveMessage };
