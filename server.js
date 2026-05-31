const express = require("express");
const { Bot } = require("grammy");
const { 
  default: makeWASocket, 
  initAuthCreds, 
  BufferJSON, 
  DisconnectReason, 
  Browsers 
} = require("@whiskeysockets/baileys");
const pino = require("pino");

const botToken = process.env.BOT_TOKEN;
const firebaseUrl = process.env.FIREBASE_URL;

const bot = new Bot(botToken);

// 1. Dummy Web Server (Render ko zinda rakhne ke liye)
const app = express();
app.get("/", (req, res) => res.send("✅ WhatsApp Cloud Server Auto-Pilot Mode Me Live Hai!"));
app.listen(process.env.PORT || 3000);

// 2. Firebase Auth State Loader
async function useSmartFirebaseAuthState() {
  let creds;
  let keys = {};
  let saveTimer = null; 

  try {
    const res = await fetch(`${firebaseUrl}/auth.json`);
    const data = await res.json();
    if (data) {
      const parsed = JSON.parse(JSON.stringify(data), BufferJSON.reviver);
      creds = parsed.creds || initAuthCreds();
      keys = parsed.keys || {};
    } else {
      creds = initAuthCreds();
    }
  } catch (e) {
    creds = initAuthCreds();
  }

  const saveToFirebase = async () => {
    try {
      await fetch(`${firebaseUrl}/auth.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creds, keys }, BufferJSON.replacer)
      });
      console.log("📦 Backup saved to Firebase.");
    } catch (e) {}
  };

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const data = {};
        for (const id of ids) {
          let value = keys[type]?.[id];
          if (value) data[id] = value;
        }
        return data;
      },
      set: (data) => {
        for (const category in data) {
          if (!keys[category]) keys[category] = {};
          for (const id in data[category]) {
            const value = data[category][id];
            if (value) keys[category][id] = value;
            else delete keys[category][id];
          }
        }
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveToFirebase, 2500);
      }
    }
  };

  return { 
    state, 
    saveCreds: () => { 
      creds = state.creds; 
      if(saveTimer) clearTimeout(saveTimer); 
      saveTimer = setTimeout(saveToFirebase, 2500); 
    } 
  };
}

let sock = null;

// 3. MAIN WHATSAPP AUTO-CONNECT FUNCTION
async function connectToWhatsApp() {
  console.log("🔄 Firebase se session check kar raha hoon...");
  const { state, saveCreds } = await useSmartFirebaseAuthState();

  if (sock) {
    try { sock.end(undefined); } catch(e){}
  }

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Windows', 'Chrome', '120.0.0.0'],
    markOnlineOnConnect: false,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("✅ SUCCESS: Render Cloud Server WhatsApp se connect ho gaya!");
    } 
    
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`❌ Connection closed. Code: ${statusCode}`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("🔄 Network issue. 5 second me reconnect kar raha hoon...");
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log("⚠️ Session logout ho gaya! Firebase clean karna padega.");
        fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" }).catch(()=>{});
      }
    }
  });
}

// 4. Telegram Controls (With New Current Status Button)
bot.command("start", (ctx) => {
  ctx.reply("🤖 Cloud Auto-Tracker System Live!\n\nControl Panel:", {
    reply_markup: {
      keyboard: [
        [{ text: "📊 Current Status" }, { text: "🔄 Force Reconnect" }], 
        [{ text: "🗑️ Reset Firebase" }]
      ],
      resize_keyboard: true,
    },
  });
});

// 🔥 NEW BUTTON HANDLER 🔥
bot.hears("📊 Current Status", (ctx) => {
  const isConnected = sock?.ws?.isOpen;
  const loggedInUser = sock?.user;

  if (isConnected && loggedInUser) {
    const myNumber = loggedInUser.id.split(":")[0];
    const myName = loggedInUser.name || "WhatsApp Device";
    
    ctx.reply(`🟢 **Status:** Connected to WhatsApp ✅\n\n📱 **Connected Number:** ${myNumber}\n👤 **Account Name:** ${myName}\n🚀 **Server Speed:** Superfast (Render Cloud)`);
  } else {
    ctx.reply("🔴 **Status:** Disconnected ❌\n\n⚠️ Cloud server par abhi koi WhatsApp login nahi hai. Kripya pehle Termux wali script se login karke keys Firebase mein bhejein.");
  }
});

bot.hears("🔄 Force Reconnect", async (ctx) => {
  await ctx.reply("⏳ Reconnecting...");
  connectToWhatsApp();
});

bot.hears("🗑️ Reset Firebase", async (ctx) => {
  try {
    await fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" });
    if(sock) sock.end(undefined);
    await ctx.reply("🗑️ Firebase completely wiped clean!");
  } catch (err) {
    await ctx.reply("⚠️ Error clearing Firebase.");
  }
});

// Boot settings
connectToWhatsApp();
bot.start();
console.log("🤖 Cloud System Fully Started!");
