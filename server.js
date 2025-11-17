// server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // أي تطبيق يقدر يتصل
});

app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

// ===== قاعدة بيانات مؤقتة في الذاكرة =====
let users = {}; // { username: { password, socketId, online } }
let messages = []; // كل الرسائل الجماعية { from, text, time }

// ===== REST API =====

// فحص السيرفر
app.get("/", (req, res) => {
  res.json({ status: "KXChat server is running ✅", usersCount: Object.keys(users).length });
});

// تسجيل حساب جديد
app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: "missing_fields" });
  if (users[username]) return res.status(400).json({ success: false, error: "user_exists" });

  users[username] = { password, socketId: null, online: false };
  console.log("HTTP: user registered", username);
  res.json({ success: true });
});

// تسجيل الدخول
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, error: "missing_fields" });

  const user = users[username];
  if (!user) return res.status(404).json({ success: false, error: "user_not_found" });
  if (user.password !== password) return res.status(401).json({ success: false, error: "wrong_password" });

  res.json({ success: true, username, online: user.online });
});

// جلب تاريخ الشات الجماعي
app.get("/api/global-history", (req, res) => {
  const chat = messages.map(m => ({ from: m.from, text: m.text, time: m.time }));
  res.json({ success: true, chat });
});

// إرسال رسالة جماعية عبر HTTP (اختياري، لأغراض Sketchware)
app.post("/api/global-message", (req, res) => {
  const { from, text } = req.body || {};
  if (!from || !text) return res.status(400).json({ success: false, error: "missing_fields" });

  const time = Math.floor(Date.now() / 1000);
  messages.push({ from, text, time });

  // إرسال للجميع عبر سوكيت
  io.emit("new_global_message", { from, text, time });

  res.json({ success: true });
});

// ===== Socket.io =====
io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  // تسجيل دخول سوكيت
  socket.on("login", (data) => {
    const { username } = data || {};
    if (!username || !users[username]) return;

    users[username].socketId = socket.id;
    users[username].online = true;
    console.log("User online via socket:", username);
  });

  // إرسال رسالة للجميع (Realtime)
  socket.on("global_message", (data, callback) => {
    const { from, text } = data || {};
    if (!from || !text) {
      if (callback) callback({ success: false, error: "missing_fields" });
      return;
    }

    const time = Math.floor(Date.now() / 1000);
    messages.push({ from, text, time });

    // إرسال للجميع مباشرة
    io.emit("new_global_message", { from, text, time });

    if (callback) callback({ success: true });
  });

  socket.on("disconnect", () => {
    // تحديث حالة المستخدم offline
    for (let u in users) {
      if (users[u].socketId === socket.id) {
        users[u].online = false;
        users[u].socketId = null;
        console.log("User disconnected:", u);
      }
    }
  });
});

// ===== تشغيل السيرفر =====
server.listen(PORT, () => {
  console.log(`🚀 KXChat server running on port ${PORT}`);
});
