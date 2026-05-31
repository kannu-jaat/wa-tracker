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

// Environment variables se secret data uthana
const botToken = process.env.BOT_TOKEN;
const firebaseUrl = process.env.FIREBASE_URL; // Firebase Database URL

if (!botToken || !firebaseUrl) {
  console.log("⚠️ BOT_TOKEN ya FIREBASE_URL missing hai!");
}

const bot = new Bot(botToken);

// 🔥 1. Dummy Web Server (Render ko zinda rakhne ke liye zaroori hai)
const app = express();
app.get("/", (req, res) => res.send("✅ WhatsApp Cloud Server Ekdum Mast Chal Raha Hai!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web Server PORT ${PORT} par chalu ho gaya.`));

// 🔥 2. Smart Firebase Auth System (Debounce / Buffer Technique)
async function useSmartFirebaseAuthState() {
  let creds;
  let keys = {};
  let saveTimer = null; // Hamara 'Jhola' (Buffer timer)

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

  // Ye function data ko ek hi jhatke me Firebase bheja karega
  const saveToFirebase = async () => {
    try {
      await fetch(`${firebaseUrl}/auth.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creds, keys }, BufferJSON.replacer)
      });
      console.log("📦 Data Batch Successfully Firebase par Save hua!");
    } catch (e) {
      console.log("❌ Firebase save error", e);
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
        // DEBOUNCE MAGIC: Agar nayi key aati hai, toh pichla timer cancel aur naya 2.5s ka timer start
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

// 🔥 3. Bot Commands & WhatsApp Engine
bot.command("start", (ctx) => {
  ctx.reply("🤖 Cloud Tracker Ready!\n\nControl Panel:", {
    reply_markup: {
      keyboard: [[{ text: "🔗 Get Pairing Code" }, { text: "📡 Check Status" }], [{ text: "🗑️ Reset Firebase" }]],
      resize_keyboard: true,
    },
  });
});

bot.hears("📡 Check Status", (ctx) => ctx.reply("✅ Cloud Server superfast speed pe chal raha hai!"));

bot.hears("🗑️ Reset Firebase", async (ctx) => {
  await ctx.reply("⏳ Firebase ka kachra saaf kar raha hoon...");
  try {
    await fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" });
    await ctx.reply("✅ Sab clean ho gaya! Ab naya /pair try karein.");
  } catch (err) {
    await ctx.reply("⚠️ Clean karne me dikkat aayi.");
  }
});

let sock;
bot.hears(/^\/pair \d+$/, async (ctx) => {
  const phoneNumber = ctx.message.text.split(" ")[1].trim();
  await ctx.reply(`⏳ ${phoneNumber} ke liye Cloud server se connection shuru...`);

  try {
    const { state, saveCreds } = await useSmartFirebaseAuthState();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false, 
      logger: pino({ level: "silent" }) 
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "connecting") {
         await ctx.reply("🔄 Loading...");
      }
      else if (connection === "open") {
        await ctx.reply("✅ BINGO! Cloud server par WhatsApp Login Successful! 🎉");
      }
      else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message;
        
        await ctx.reply(`❌ Connection Fail!\nWajeh: ${errorMsg} (Code: ${statusCode})`);

        if (statusCode === DisconnectReason.loggedOut) {
          await ctx.reply("⚠️ Logout ho gaya. '🗑️ Reset Firebase' dabayein aur /pair karein.");
          fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" }).catch(()=>{});
        }
      }
    });

    if (!sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
          await ctx.reply(`📲 Aapka Code hai:\n\n**${formattedCode}**\n\nJaldi se WhatsApp me daalein!`);
        } catch (err) {
          await ctx.reply(`⚠️ Code error: ${err.message}`);
        }
      }, 2500); 
    } else {
      await ctx.reply("⚠️ File me data pehle se save hai. Bot khud try kar raha hai connect karne ki.");
    }
  } catch (err) {
    await ctx.reply(`⚠️ Code Error: ${err.message}`);
  }
});

// Bot Start 
bot.start();
console.log("🤖 Cloud Bot Ready!");
