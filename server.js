const express = require("express");
const WebSocket = require("ws");
const bcrypt = require("bcrypt");
const http = require("http");

const { generateToken, verifyToken } = require("./auth");
const {
  encryptPhoneNumber,
  decryptPhoneNumber,
  saveMessage,
  checkUserType,
  saveFriendRequest,
  getUserProfile,
  readMessage,
} = require("./utils");
const pool = require("./localdb");
const env = require("./env");

const OSS = require('ali-oss');
const config = {
  region: 'oss-cn-nanjing',
  accessKeyId: process.env.ACCESS_KEY_ID,
  accessKeySecret: process.env.ACCESS_KEY_SECRET,
  authorizationV4: true,
  bucket: 'aichatapp-image',
};

const saltRounds = 10;
/**
 * @param {import('express').Request} req - The request object
 * @param {import('express').Response} res - The response object
 */

const OnlineUsers = new Map();

const cors = require("cors");
const { getAIResponse } = require("./aichat");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({extended: true}))
app.use(cors());
// app.use(JSON.stringify({ limit: '10mb' }));
// app.use(urlencoded({ limit: '10mb', extended: true }));

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

app.get("/api/getfriendlist", async (req, res) => {
  if (!pool) {
    return res.status(500).send("Database not initialized");
  }
  try {
    const [results] = await pool.query("SELECT * FROM friends");
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
    SELECT id AS friend_id, nickname, avatar, isbot
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
  ws.on("message", async (data) => {
    const parsedData = JSON.parse(data);
    console.log(`Received message: ${parsedData.type}`);
    let token = parsedData.token;
    let userId = verifyToken(token);
    switch (parsedData.type) {
      case "connect":
        ws.userId = userId;
        OnlineUsers.set(userId, ws);
        console.log("Welcome to the WebSocket server!");
        break;
      case "sendMessage":
        //console.log(parsedData);
        const sender_id = ws.userId;
        console.log(`senderid: ${sender_id}`);
        const receiver_id = parsedData.receiverId;
        console.log(`receiverid: ${receiver_id}`);
        const message_type = parsedData.message_type;
        console.log(`message type: ${message_type}`);
        const usertype = await checkUserType(receiver_id).catch((error) => {
          console.error("Error:", error.message);
        }); // true for bot
        console.log(`usertype: ${usertype}`);
        if (!usertype) {
          const content = parsedData.content;
          console.log("The receiver is human");
          if (OnlineUsers.has(receiver_id)) {
            const receiverWs = OnlineUsers.get(receiver_id);
            receiverWs.send(
              JSON.stringify({
                type: "newMessage",
                sender_id,
                content,
                timestamp: new Date().toISOString(),
              })
            );

            await saveMessage(
              sender_id,
              receiver_id,
              content,
              message_type,
              true
            );
            console.log(
              `Message from ${sender_id} to ${receiver_id}, type ${message_type} forwarded.`
            );
          } else {
            await saveMessage(
              sender_id,
              receiver_id,
              content,
              message_type,
              false
            );
            console.log(
              `Message from ${sender_id} to ${receiver_id}, type ${message_type} saved as undelivered.`
            );
          }
        } else {
          console.log("The receiver is bot");
          const messages = parsedData.historyMessages;
          const lastmessage = messages.at(-1);
          saveMessage(
            lastmessage.sender_id,
            lastmessage.receiver_id,
            lastmessage.content,
            `"${lastmessage.messageType}"`,
            true
          );
          //console.log(messages);
          const modelId = "Qwen/Qwen2-7B-Instruct-GGUF";
          const apiKey = "7861e011-ca80-4dcb-b9fe-0801460a4087";
          const baseUrl =
            "https://ms-fc-2ef7dfba-37f9.api-inference.modelscope.cn/v1";
          const response = await getAIResponse(
            modelId,
            messages,
            apiKey,
            baseUrl,
            sender_id
          );
          if (OnlineUsers.has(sender_id)) {
            const senderWs = OnlineUsers.get(sender_id);
            senderWs.send(
              JSON.stringify({
                type: "newMessage",
                receiver_id,
                response,
                timestamp: new Date().toISOString(),
              })
            );
            saveMessage(
              lastmessage.receiver_id,
              lastmessage.sender_id,
              response,
              `"${lastmessage.messageType}"`,
              true
            );
          } else {
            saveMessage(
              lastmessage.receiver_id,
              lastmessage.sender_id,
              response,
              `"${lastmessage.messageType}"`,
              false
            );
          }
          console.log(response);
        }
        break;
      case "sendFriendRequest":
        const friend_id = parsedData.receiverId;
        const description = parsedData.description;
        const userProfile = await getUserProfile(userId);
        if (OnlineUsers.has(friend_id)) {
          const receiverWs = OnlineUsers.get(friend_id);
          receiverWs.send(
            JSON.stringify({
              type: "newFriendRequest",
              friendId: userId,
              description,
              avatar: userProfile.avatar,
              nickname: userProfile.nickname,
              timestamp: new Date().toISOString(),
            })
          );
          await saveFriendRequest(userId, friend_id, "pending");
          console.log(
            `Friend request from ${userId} to ${friend_id} forwarded.`
          );
        } else {
          await saveFriendRequest(userId, friend_id, "pending");
          console.log(
            `Friend request from ${userId} to ${friend_id} saved as pending.`
          );
        }
        break;
      case "readMessage":
        const senderId = parsedData.senderId;
        const result = await readMessage(userId, senderId);
        console.log(`Messages from ${senderId} to ${userId} marked as read, count: ${result.affectedRows}`);
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
  const { userId: user_id, friendId: friend_id, afterTime: after_time } = req.body;

  if (!user_id || !friend_id || !after_time) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const query = `
    SELECT * FROM messages
    WHERE 
      ((sender_id = ? AND receiver_id = ?)
      OR 
      (sender_id = ? AND receiver_id = ?))
      AND timestamp > ?
    ORDER BY timestamp DESC
  `;

  try {
    const [results] = await pool.query(query, [
      user_id,
      friend_id,
      friend_id,
      user_id,
      after_time,
    ]);
    console.log(`Fetching ${results.length} messages`);
    const reorderedResults = results.map((message, index) => {
      return { ...message, message_id: index + 1 };
    });
    res.json({ messages: reorderedResults });
    //console.log(reorderedResults);
  } catch (err) {
    console.error("Database error:", err.message);
    res.status(500).json({ error: "Database query failed" });
  }
});
app.post("/api/fetchUrl", async (req, res) => {
  console.log("fetchUrl request");
  let objectKey = req.header(`Object-Key`).toString();
  let method = req.header(`Method`).toString();
  let contentType = req.header(`Content-Type`).toString();
  console.log(objectKey);
  console.log(method);
  console.log(contentType);

  const client = new OSS(config);

  try {
    let response = await client.asyncSignatureUrl(objectKey, {expires: 60, method: method, "Content-Type": method == 'PUT'? contentType: null});
    console.log('success');
    return res.status(200).send(response);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 启动服务器
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
