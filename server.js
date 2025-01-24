const express = require("express");
const WebSocket = require("ws");
const bcrypt = require("bcrypt");
const http = require("http");

const { generateToken, verifyToken } = require("./auth");
const {
  encryptPhoneNumber,
  decryptPhoneNumber,
  saveMessage,
} = require("./utils");
const pool = require("./db");
const saltRounds = 10;
/**
 * @param {import('express').Request} req - The request object
 * @param {import('express').Response} res - The response object
 */

const OnlineUsers = new Map();

const cors = require("cors");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
  const isWebSocket =
    req.headers.upgrade && req.headers.upgrade.toLowerCase() === "websocket";
  if (isWebSocket) {
    return next();
  }
  next();
});
// get user list. Only avaliable for administrators.
app.get("/api/getuser", async (req, res) => {
  if (!pool) {
    return res.status(500).send("Database not initialized");
  }
  try {
    const [results] = await pool.query("SELECT * FROM users");
    res.json(results);
  } catch (err) {
    console.error("Database query failed:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

// Register.
app.post("/api/register", async (req, res) => {
  console.log("Register request from client");

  const { username, password, phone_number } = req.body;

  // 检查必要字段
  if (!username || !password || !phone_number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 加密电话号码
    const encrypted = encryptPhoneNumber(phone_number);

    // 插入用户数据
    const query =
      "INSERT INTO users (username, password, encrypted_phone, iv) VALUES (?, ?, ?, ?)";
    const [results] = await pool.query(query, [
      username,
      hashedPassword,
      encrypted.encryptedData,
      encrypted.iv,
    ]);

    // 返回成功响应
    res.json({ success: true, userId: results.insertId });
  } catch (err) {
    console.error("Error during user registration:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete.
app.delete("/api/delete", (req, res) => {
  const userId = req.params.id;
  const query = "DELETE FROM users WHERE id = ?";

  pool.query(query, [userId], (err, results) => {
    if (err) {
      res.status(500).json({ error: "Failed to delete user" });
      return;
    }
    res.json({ success: true, affectedRows: results.affectedRows });
  });
});
// Login.
app.post("/api/login", async (req, res) => {
  console.log("Login request from client");
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const [user] = await pool.query(
      "SELECT id, password, nickname FROM users WHERE username = ?",
      [username]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    } else if (user.length > 1) {
      return res.status(404).json({ error: "Multiple Users" });
    }

    const hashedPassword = user[0].password;
    const userId = user[0].id;
    const nickname = user[0].nickname;
    console.log(`{user${userId}}`);
    // verify password
    const isMatch = await bcrypt.compare(password, hashedPassword);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    // login succeed
    const token = generateToken({ id: userId, username: username }, "7d");
    console.log(`User ${userId} logged in.`);
    res.json({
      success: true,
      message: "Login successful",
      token: token,
      user_id: userId,
      nickname: nickname,
    });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/getfriends", async (req, res) => {
  const token = req.query.token;
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(400).json({ error: "Invalid token" });
  }
  try {
    const query = `
    SELECT DISTINCT 
        CASE 
            WHEN user_id = ? THEN friend_id
            ELSE user_id
        END AS friend_id
    FROM friends
    WHERE 
        (user_id = ? OR friend_id = ?)
        AND status = 'accepted';
    `;

    const [results] = await pool.query(query, [userId, userId, userId]);
    const friendIds = Array.from(
      new Set(results.map((result) => result.friend_id))
    );

    if (friendIds.length === 0) {
      return res.json([]);
    }
    const userQuery = `
    SELECT id AS friend_id, nickname, avatar
    FROM users
    WHERE id IN (?)
  `;
    const [userResults] = await pool.query(userQuery, [friendIds]);
    //console.log("Query Results:", userResults);

    res.json(userResults);
  } catch (err) {
    console.error("Database query failed:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

wss.on("connection", (ws, req) => {
  console.log("Client connected from:", req.socket.remoteAddress);

  // 监听来自客户端的消息
  ws.on("message", async (data) => {
    const parsedData = JSON.parse(data);
    console.log(`Received message: ${parsedData}`);
    let token = parsedData.token;
    let userId = verifyToken(token);
    switch (parsedData.type) {
      case "connect":
        ws.userId = userId;
        OnlineUsers.set(userId, ws);
        ws.send("Welcome to the WebSocket server!");
        break;
      case "sendMessage":
        console.log(parsedData);
        const sender_id = ws.userId;
        console.log(sender_id);
        const receiver_id = parsedData.receiverId;
        const content = parsedData.content;
        if (OnlineUsers.has(receiver_id)) {
          const receiverWs = OnlineUsers.get(receiver_id);
          receiverWs.send(
            JSON.stringify({
              type: "message",
              sender_id,
              content,
              timestamp: new Date().toISOString(),
            })
          );

          await saveMessage(sender_id, receiver_id, content, true);
          console.log(`Message from ${sender_id} to ${receiver_id} forwarded.`);
        } else {
          await saveMessage(sender_id, receiver_id, content, false);
          console.log(
            `Message from ${sender_id} to ${receiver_id} saved as undelivered.`
          );
        }
        break;
      case "sendFriendRequest":
        const friend_id = parsedData.receiverId;
        if (OnlineUsers.has(friend_id)) {
          const receiverWs = OnlineUsers.get(friend_id);
          receiverWs.send(
            JSON.stringify({
              type: "friendRequest",
              sender_id,
              timestamp: new Date().toISOString(),
            })
          );
          await saveFriendRequest(sender_id, receiver_id, "pending");
          console.log(
            `Friend request from ${sender_id} to ${receiver_id} forwarded.`
          );
        } else {
          await saveFriendRequest(sender_id, receiver_id, "pending");
          console.log(
            `Friend request from ${sender_id} to ${receiver_id} saved as pending.`
          );
        }
        break;
    }
  });
  ws.on("close", () => {
    OnlineUsers.delete(ws.userId);
    console.log("Client disconnected");
  });
  ws.on("error", (err) => {
    console.error(`WebSocket error: ${err.message}`);
  });
});
app.post("/api/fetchChatHistory", async (req, res) => {
  console.log("fetchChatHistory request");
  console.log(req.body);
  const { userId: user_id, friendId: friend_id, messageNum: n } = req.body;

  if (!user_id || !friend_id || !n) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const query = `
    SELECT * FROM messages
    WHERE 
      (sender_id = ? AND receiver_id = ?)
      OR 
      (sender_id = ? AND receiver_id = ?)
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  try {
    const [results] = await pool.query(query, [
      user_id,
      friend_id,
      friend_id,
      user_id,
      parseInt(n),
    ]);
    res.json({ messages: results });
    //console.log(results);
  } catch (err) {
    console.error("Database error:", err.message);
    res.status(500).json({ error: "Database query failed" });
  }
});

// 启动服务器
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
