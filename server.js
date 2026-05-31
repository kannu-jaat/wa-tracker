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

// 1. Environment Variables
const botToken = process.env.BOT_TOKEN;
const firebaseUrl = process.env.FIREBASE_URL;

if (!botToken || !firebaseUrl) {
  console.log("⚠️ BOT_TOKEN ya FIREBASE_URL missing hai!");
}

const bot = new Bot(botToken);

// 2. Express Server (Render ko zinda rakhne ke liye)
const app = express();
app.get("/", (req, res) => res.send("✅ WhatsApp Cloud Server Live Aur Daud Raha Hai!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web Server PORT ${PORT} par chalu ho gaya.`));

// 3. Smart Firebase Auth System (Buffer / Debounce Technique)
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
      console.log("📦 Data Batch Firebase par Save Hua!");
    } catch (e) {
      console.log("❌ Firebase Save Error:", e.message);
    }
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

// 4. Telegram Bot Commands & Menu
bot.command("start", (ctx) => {
  ctx.reply("🤖 Cloud Tracker Ready!\n\nControl Panel:", {
    reply_markup: {
      keyboard: [
        [{ text: "📸 Get QR Code" }, { text: "📡 Check Status" }], 
        [{ text: "🗑️ Reset Firebase" }]
      ],
      resize_keyboard: true,
    },
  });
});

bot.hears("📡 Check Status", (ctx) => ctx.reply("✅ Cloud Server superfast speed pe chal raha hai!"));

bot.hears("🗑️ Reset Firebase", async (ctx) => {
  await ctx.reply("⏳ Firebase saaf kar raha hoon...");
  try {
    await fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" });
    await ctx.reply("✅ Sab clean ho gaya! Puraana kachra saaf.");
  } catch (err) {
    await ctx.reply("⚠️ Clean karne me problem aayi.");
  }
});

let sock;

// 5. WhatsApp Engine (QR Code & Connection)
bot.hears("📸 Get QR Code", async (ctx) => {
  await ctx.reply("⏳ QR Code generate kar raha hoon... (Fast Server se)");

  try {
    const { state, saveCreds } = await useSmartFirebaseAuthState();

    // Puraana connection atka ho toh usko band karo
    if (sock) {
      try { sock.end(undefined); } catch(e){}
    }

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true, // 🔥 Render ke logs/terminal me bhi dikhega
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false, 
      logger: pino({ level: "silent" }) 
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("🟢 QR Code generated!");
        // Fast API for QR Code image
        const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=400`;
        
        try {
          await ctx.replyWithPhoto(qrImageUrl, { 
            caption: "📸 Naya QR Code!\n\nJaldi se apne dusre phone/PC mein khol kar scan karein." 
          });
        } catch (photoErr) {
          console.log("⚠️ Telegram Photo Error:", photoErr.message);
          await ctx.reply("⚠️ Telegram ne photo load nahi ki! Kripya Render ke logs (terminal) mein jakar scan karein.");
        }
      }

      if (connection === "connecting") {
         console.log("🔄 Connecting to WhatsApp...");
      }
      else if (connection === "open") {
        await ctx.reply("✅ BINGO! Cloud server par WhatsApp Login Successful! Jadoo chal gaya! 🎉");
      }
      else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message;
        
        console.log(`❌ Connection Closed: ${statusCode} - ${errorMsg}`);

        // 405 error (Soft Ban) ko ignore karke baaki errors batayega
        if (statusCode !== 405) { 
          await ctx.reply(`❌ Connection Fail!\nWajeh: ${errorMsg} (Code: ${statusCode})`);
        } else {
           console.log("⚠️ Code 405 Blocked by WhatsApp.");
        }

        if (statusCode === DisconnectReason.loggedOut) {
          await ctx.reply("⚠️ Device Logout ho gaya. '🗑️ Reset Firebase' dabayein aur wapas try karein.");
          fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" }).catch(()=>{});
        }
      }
    });

  } catch (err) {
    await ctx.reply(`⚠️ Server Error: ${err.message}`);
  }
});

bot.start();
console.log("🤖 Telegram Bot Started successfully!");
