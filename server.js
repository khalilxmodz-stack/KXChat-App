// KXChat Realtime Chat Server
// by Khalil Xmodz & ChatGPT 😎

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// =======================
// إعداد الأساسيات
// =======================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// إعداد Socket.io مع CORS مفتوح (للتجارب)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// =======================
// "قاعدة بيانات" بسيطة في الرام
// (بداية فقط، لاحقًا ممكن نستخدم MongoDB أو غيره)
// =======================

/*
users = {
  username: {
    password: "1234",
    socketId: "...",
    online: true/false
  }
}
*/

const users = {};

// messages = قائمة رسائل محفوظة (اختياري)
const messages = []; 
// كل عنصر:
// { from, to, text, time }

function nowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// =======================
// API بسيط للتجربة/الفحص
// =======================

app.get("/", (req, res) => {
  res.json({
    status: "KXChat server is running ✅",
    usersCount: Object.keys(users).length
  });
});

// لإرجاع قائمة المستخدمين الأونلاين (اختياري)
app.get("/online-users", (req, res) => {
  const online = Object.keys(users).filter(u => users[u].online);
  res.json({ online });
});

// =======================
// REST API for KXChat (HTTP endpoints for Sketchware)
// =======================

// تسجيل حساب جديد عبر HTTP
app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "missing_fields" });
  }
  if (users[username]) {
    return res.status(400).json({ success: false, error: "user_exists" });
  }

  users[username] = { password, socketId: null, online: false };
  console.log("HTTP: user registered", username);
  return res.json({ success: true });
});

// تسجيل الدخول عبر HTTP
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "missing_fields" });
  }
  const user = users[username];
  if (!user) {
    return res.status(404).json({ success: false, error: "user_not_found" });
  }
  if (user.password !== password) {
    return res.status(401).json({ success: false, error: "wrong_password" });
  }

  // HTTP login فقط للتحقق من البيانات، ربط الـ socket يتم في حدث socket "login"
  return res.json({ success: true, username, online: user.online });
});

// إرسال رسالة عبر HTTP
app.post("/api/send-message", (req, res) => {
  const { from, to, text } = req.body || {};
  if (!from || !to || !text) {
    return res.status(400).json({ success: false, error: "missing_fields" });
  }
  if (!users[from] || !users[to]) {
    return res.status(404).json({ success: false, error: "user_not_found" });
  }

  const time = Math.floor(Date.now() / 1000);
  messages.push({ from, to, text, time });

  // إرسال عبر سوكيت لو المستقبل أونلاين
  if (users[to].socketId) {
    io.to(users[to].socketId).emit("new_message", { from, to, text, time });
  }
  if (users[from].socketId) {
    io.to(users[from].socketId).emit("new_message", { from, to, text, time });
  }

  return res.json({ success: true });
});

// جلب سجل المحادثة بين شخصين
app.get("/api/chat-history", (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ success: false, error: "missing_fields" });
  }

  const chat = messages.filter(m =>
    (m.from === user1 && m.to === user2) ||
    (m.from === user2 && m.to === user1)
  );

  return res.json({ success: true, chat });
});

// =======================
// Socket.io Events
// =======================

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  // -------------------
  // تسجيل مستخدم جديد عبر Socket
  // data: { username, password }
  // -------------------
  socket.on("register", (data, callback) => {
    const { username, password } = data || {};

    if (!username || !password) {
      if (callback) callback({ success: false, error: "missing_fields" });
      return;
    }

    if (users[username]) {
      // يوجد مستخدم بنفس الاسم
      if (callback) callback({ success: false, error: "user_exists" });
      return;
    }

    users[username] = {
      password,
      socketId: null,
      online: false
    };

    console.log(`🆕 User registered (socket): ${username}`);
    if (callback) callback({ success: true });
  });

  // -------------------
  // تسجيل الدخول عبر Socket
  // data: { username, password }
  // -------------------
  socket.on("login", (data, callback) => {
    const { username, password } = data || {};

    if (!username || !password) {
      if (callback) callback({ success: false, error: "missing_fields" });
      return;
    }

    const user = users[username];
    if (!user) {
      if (callback) callback({ success: false, error: "user_not_found" });
      return;
    }

    if (user.password !== password) {
      if (callback) callback({ success: false, error: "wrong_password" });
      return;
    }

    // تسجيل دخول ناجح
    user.socketId = socket.id;
    user.online = true;
    socket.data.username = username; // نخزن الاسم في socket

    console.log(`✅ User logged in (socket): ${username} (socket: ${socket.id})`);

    // إرسال حالة أونلاين لباقي المستخدمين
    io.emit("user_status", {
      username,
      online: true
    });

    if (callback) {
      callback({
        success: true,
        username,
        onlineUsers: Object.keys(users).filter(u => users[u].online)
      });
    }
  });

  // -------------------
  // رسالة خاصة بين مستخدمين عبر Socket
  // data: { from, to, text }
  // -------------------
  socket.on("private_message", (data, callback) => {
    const { from, to, text } = data || {};

    if (!from || !to || !text) {
      if (callback) callback({ success: false, error: "missing_fields" });
      return;
    }

    if (!users[from]) {
      if (callback) callback({ success: false, error: "from_not_found" });
      return;
    }
    if (!users[to]) {
      if (callback) callback({ success: false, error: "to_not_found" });
      return;
    }

    const time = nowTimestamp();

    // حفظ الرسالة في الذاكرة (اختياري)
    messages.push({ from, to, text, time });

    console.log(`✉️ ${from} -> ${to}: ${text}`);

    // إرسال الرسالة للمرسل (حتى يضيفها في شات نفسه)
    if (users[from].socketId) {
      io.to(users[from].socketId).emit("new_message", {
        from,
        to,
        text,
        time
      });
    }

    // إرسال الرسالة للمستقبل لو أونلاين
    if (users[to].socketId) {
      io.to(users[to].socketId).emit("new_message", {
        from,
        to,
        text,
        time
      });
    }

    if (callback) callback({ success: true });
  });

  // -------------------
  // طلب محادثة مع شخص (جلب الرسائل القديمة بين شخصين) عبر Socket
  // data: { user1, user2 }
  // -------------------
  socket.on("get_chat_history", (data, callback) => {
    const { user1, user2 } = data || {};

    if (!user1 || !user2) {
      if (callback) callback({ success: false, error: "missing_fields" });
      return;
    }

    const chat = messages.filter(m =>
      (m.from === user1 && m.to === user2) ||
      (m.from === user2 && m.to === user1)
    );

    if (callback) callback({ success: true, chat });
  });

  // -------------------
  // عند فصل الاتصال
  // -------------------
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);

    // نبحث هل في مستخدم مرتبط بهذا socket
    let disconnectedUser = null;
    for (const username in users) {
      if (users[username].socketId === socket.id) {
        disconnectedUser = username;
        break;
      }
    }

    if (disconnectedUser) {
      users[disconnectedUser].online = false;
      users[disconnectedUser].socketId = null;

      console.log(`🚫 User offline: ${disconnectedUser}`);

      // إخبار بقية المستخدمين
      io.emit("user_status", {
        username: disconnectedUser,
        online: false
      });
    }
  });
});

// =======================
// تشغيل السيرفر
// =======================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 KXChat server running on port ${PORT}`);
});
