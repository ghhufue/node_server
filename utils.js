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
    INSERT INTO messages (sender_id, receiver_id, content, message_type, is_received, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  try {
    let connection = await pool.getConnection();
    await connection.query(query, [
      sender_id,
      receiver_id,
      content,
      message_type,
      is_received,
      new Date().toISOString(),
    ]);
    const [results] = await connection.query('SELECT message_id, timestamp FROM messages WHERE message_id = LAST_INSERT_ID()');
    connection.release();

    return {      
      message_id: results[0].message_id,
      timestamp: results[0].timestamp,
    };
  } catch (error) {
    console.error("Error saving message to database:", error.message);
    throw error;
  }
}
/*
  return new Promise((resolve, reject) => {
    pool.query(
      query,
      [sender_id, receiver_id, content, message_type, is_received, new Date().toISOString().replace('T', ' ').replace('Z', '')],
      (err, results) => {
        console.log('Inside pool.query');
        if (err) {
          console.error("Error saving message to database:", err.message);
          reject(err);
        }
        console.log(`Returning the message ${results.message_id}, sender id ${results.sender_id}, receiver id ${results.receiver_id}, message type ${results.message_type}, timestamp ${results.timestamp}.`);
        resolve({
          message_id: results.message_id,
          sender_id: results.sender_id,
          receiver_id: results.receiver_id,
          content: results.content,
          message_type: results.message_type,
          timestamp: results.timestamp.replace(' ', 'T') + 'Z',
        });
      }
    );
  });
}
*/
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
      INSERT INTO friends (user_id, friend_id, status, created_at)
      VALUES 
        (?, ?, ?, NOW()), 
        (?, ?, ?, NOW());
    `;
    
    await pool.query(insertQuery, [
      sender_id, receiver_id, status,
      receiver_id, sender_id, status
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
      WHERE receiver_id = ? AND sender_id = ? 
    `;
    const [results] = await pool.query(query, [userId, senderId]);
    return results;
  } catch (error) {
    console.error("Error reading message:", error);
    throw error;
  }
}

async function markAsRead(messageId) {
  try {
    const query = `
      UPDATE messages 
      SET is_received = 1 
      WHERE message_id = ? 
    `;
    const [results] = await pool.query(query, [messageId]);
    return results;
  } catch (error) {
    console.error("Error marking message as read:", error);
    throw error;
  }
}

async function updateRelation(userId, friendId, status) {
  console.log(`Update relationship between ${userId} and ${friendId}`);
  if (status !== "accepted" && status !== "unrelated") {
    return {
      success: false,
      message: 'Invalid status. Only "accepted" or "unrelated" are allowed.',
    };
  }
  try {
    const [rows] = await pool.query(
      "SELECT * FROM friends WHERE user_id = ? AND friend_id = ?",
      [friendId, userId]
    );
    if (rows.length === 0) {
      return {
        success: false,
        message: "No friend request found between these users.",
      };
    }
    const updatePromises = [
      pool.query(
        "UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?",
        [status, userId, friendId]
      ),
      pool.query(
        "UPDATE friends SET status = ? WHERE friend_id = ? AND user_id = ?",
        [status, userId, friendId]
      ),
    ];
    const results = await Promise.all(updatePromises);
    if (results[0][0].affectedRows > 0 && results[1][0].affectedRows > 0) {
      return {
        success: true,
        message: "Friend request status updated successfully for both users.",
      };
    } else {
      return {
        success: false,
        message: "Failed to update the status.",
      };
    }
  } catch (error) {
    console.error("Error:", error.message);
    return {
      success: false,
      message: `An error occurred: ${error.message}`,
    };
  }
}
module.exports = {
  encryptPhoneNumber,
  decryptPhoneNumber,
  saveMessage,
  checkUserType,
  saveFriendRequest,
  getUserProfile,
  updateRelation,
  readMessage,
  markAsRead,
};
