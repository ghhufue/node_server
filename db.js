const mysql = require("mysql2/promise");
const pool = mysql.createPool({
    host: "localhost",
    user: "remote_user",
    password: "yht20050302",
    database: "chatappdb",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
module.exports = pool;
