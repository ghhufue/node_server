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

async function saveMessage(
  sender_id,
  receiver_id,
  content,
  message_type,
  is_received
) {
  //console.log('Pool:', pool);
  const query = `
    INSERT INTO messages (sender_id, receiver_id, content, message_type, is_received)
    VALUES (?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    pool.query(
      query,
      [sender_id, receiver_id, content, message_type, is_received],
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
async function saveFriendRequest(sender_id, receiver_id, status) {
  try {
    const checkQuery = `
      SELECT * FROM friends 
      WHERE user_id = ? AND friend_id = ?
    `;
    const [existingRequest] = await pool.query(checkQuery, [
      sender_id,
      receiver_id,
    ]);

    if (existingRequest.length > 0) {
      const updateQuery = `
        UPDATE friends 
        SET status = ?, created_at = NOW() 
        WHERE user_id = ? AND friend_id = ?
      `;

      const [updateResult] = await pool.query(updateQuery, [
        status,
        sender_id,
        receiver_id,
      ]);
      console.log("Updated friend request");
      //return updateResult;
    } else {
      const insertQuery = `
        INSERT INTO friends (user_id, friend_id, status, created_at ) 
        VALUES (?, ?, ?, NOW())
      `;

      const [insertResult] = await pool.query(insertQuery, [
        sender_id,
        receiver_id,
        status,
      ]);
      console.log("Inserted new friend request");
      //return insertResult;
    }
  } catch (error) {
    console.error("Error saving/updating friend request:", error);
    throw error;
  }
}

async function checkUserType(userId) {
  const query = "SELECT isbot FROM users WHERE id = ?";
  try {
    const [results] = await pool.query(query, [userId]);
    if (results.length === 0) {
      throw new Error(`User with ID ${userId} not found.`);
    }
    const isBot = results[0].isbot;
    return isBot === 1;
  } catch (err) {
    throw new Error(`Error in checkUserType: ${err.message}`);
  }
}
async function getUserProfile(userId) {
  try {
    const query = `SELECT nickname, avatar FROM users WHERE id = ? LIMIT 1`;
    const [rows] = await pool.query(query, [userId]);
    if (rows.length > 0) {
      return {
        nickname: rows[0].nickname,
        avatar: rows[0].avatar,
      };
    } else {
      return null; // 用户不存在
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    return null;
  }
}

async function readMessage(userId, senderId) {
  try {
    const query = `
      UPDATE messages 
      SET is_received = 1 
      WHERE receiver_id = ? AND sender_id = ? AND is_received = 0
    `;
    const [results] = await pool.query(query, [userId, senderId]);
    return results;
  } catch (error) {
    console.error("Error reading message:", error);
    throw error;
  }
}

module.exports = {
  encryptPhoneNumber,
  decryptPhoneNumber,
  saveMessage,
  checkUserType,
  saveFriendRequest,
  getUserProfile,
};
