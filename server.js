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
const app = express();
app.get("/", (req, res) => res.send("✅ WhatsApp Cloud Server Live!"));
app.listen(process.env.PORT || 3000);

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

// 🔥 NAYA MENU 🔥
bot.command("start", (ctx) => {
  ctx.reply("🤖 Cloud Tracker Ready!", {
    reply_markup: {
      keyboard: [[{ text: "📸 Get QR Code" }, { text: "📡 Check Status" }], [{ text: "🗑️ Reset Firebase" }]],
      resize_keyboard: true,
    },
  });
});

bot.hears("📡 Check Status", (ctx) => ctx.reply("✅ Cloud Server superfast speed pe chal raha hai!"));

bot.hears("🗑️ Reset Firebase", async (ctx) => {
  await ctx.reply("⏳ Firebase saaf kar raha hoon...");
  try {
    await fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" });
    await ctx.reply("✅ Sab clean ho gaya!");
  } catch (err) {}
});

let sock;
bot.hears("📸 Get QR Code", async (ctx) => {
  await ctx.reply("⏳ QR Code generate kar raha hoon...");

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
      const { connection, lastDisconnect, qr } = update;

      // 🔥 NAYA QR CODE SYSTEM 🔥
      if (qr) {
        // Baileys ke raw QR ko image me convert karke Telegram par bhejega
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}`;
        await ctx.replyWithPhoto(qrImageUrl, { caption: "📸 Apne dusre phone ya PC par is photo ko kholen aur apne main WhatsApp se scan karein!\n\n(Naya QR har 20 second mein aayega jab tak scan nahi hoga)" });
      }

      if (connection === "open") {
        await ctx.reply("✅ BINGO! Cloud server par WhatsApp Login Successful! 🎉");
      }
      else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message;
        
        // Agar normal disconnect hota hai toh notification aayega
        if (statusCode !== 405) { 
            await ctx.reply(`❌ Connection Fail! (Code: ${statusCode})`);
        }

        if (statusCode === DisconnectReason.loggedOut) {
          fetch(`${firebaseUrl}/auth.json`, { method: "DELETE" }).catch(()=>{});
        }
      }
    });

  } catch (err) {
    await ctx.reply(`⚠️ Error: ${err.message}`);
  }
});

bot.start();
console.log("🤖 Cloud Bot Ready!");
