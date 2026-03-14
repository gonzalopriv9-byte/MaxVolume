// utils/voz.js — Reconocimiento de voz
// "Hey Puti pon [canción]" → reproduce la canción

const { EndBehaviorType } = require("@discordjs/voice");
const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");

const TMP_DIR = "/tmp/nexabot_voice";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const WAKE_WORDS = ["hey puti", "ei puti", "hey putis", "oye puti"];
const processing = new Set();

async function transcribe(pcmFile) {
  return new Promise((resolve) => {
    const wavFile = pcmFile.replace(".pcm", ".wav");
    const ff = spawn("ffmpeg", [
      "-f", "s16le", "-ar", "48000", "-ac", "1",
      "-i", pcmFile,
      "-ar", "16000", "-y", wavFile, "-loglevel", "error",
    ]);
    ff.on("close", () => {
      if (!fs.existsSync(wavFile)) { resolve(null); return; }
      const py = spawn("python3", ["-c", `
import speech_recognition as sr
r = sr.Recognizer()
try:
    with sr.AudioFile('${wavFile}') as source:
        audio = r.record(source)
    text = r.recognize_google(audio, language='es-ES')
    print(text.lower())
except:
    print('')
`]);
      let out = "";
      py.stdout.on("data", d => out += d.toString());
      py.on("close", () => {
        try { fs.unlinkSync(pcmFile); } catch {}
        try { fs.unlinkSync(wavFile); } catch {}
        resolve(out.trim() || null);
      });
    });
  });
}

function extractSong(text) {
  for (const wake of WAKE_WORDS) {
    const idx = text.indexOf(wake);
    if (idx !== -1) {
      const after = text.slice(idx + wake.length).trim();
      const match = after.match(/^(?:pon|poner|ponme|pone)\s+(.+)$/i);
      if (match) return match[1].trim();
      if (after.length > 2) return after;
    }
  }
  return null;
}

function startVoiceListener(connection, textChannel, client, guildId) {
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (processing.has(userId)) return;
    processing.add(userId);

    const pcmFile = path.join(TMP_DIR, `v_${userId}_${Date.now()}.pcm`);
    const fileStream = fs.createWriteStream(pcmFile);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });

    const ffmpeg = spawn("ffmpeg", [
      "-f", "opus", "-i", "pipe:0",
      "-f", "s16le", "-ar", "48000", "-ac", "1",
      "-loglevel", "error", "pipe:1",
    ]);

    let closed = false;

    function safeEnd() {
      if (closed) return;
      closed = true;
      try { audioStream.destroy(); } catch {}
      try { ffmpeg.stdin.end(); } catch {}
    }

    ffmpeg.stdin.on("error", (err) => {
      if (err.code === "EPIPE") {
        console.warn(`[Voz] EPIPE en stdin de ffmpeg para ${userId} (ignorando)`);
        safeEnd();
      }
    });

    ffmpeg.stdout.on("error", () => {});
    ffmpeg.on("error", () => { processing.delete(userId); });
    ffmpeg.on("close", () => {
      safeEnd();
    });

    audioStream.on("end", () => {
      safeEnd();
    });
    
    audioStream.on("error", () => {
      safeEnd();
      processing.delete(userId);
    });

    ffmpeg.stdout.pipe(fileStream);

    fileStream.on("finish", async () => {
      try {
        const stats = fs.existsSync(pcmFile) ? fs.statSync(pcmFile) : null;
        if (!stats || stats.size < 48000) {
          try { fs.unlinkSync(pcmFile); } catch {}
          processing.delete(userId);
          return;
        }

        const text = await transcribe(pcmFile);
        if (!text) { processing.delete(userId); return; }
        console.log(`[Voz] ${userId}: "${text}"`);

        const song = extractSong(text);
        if (!song) { processing.delete(userId); return; }
        console.log(`[Voz] Canción detectada: "${song}"`);

        const guild  = client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId);
        const name   = member?.displayName || "alguien";

        await textChannel.send(`🎤 **${name}** ha pedido por voz: **${song}**`);

        const musicaCmd = client.commands.get("musica");
        if (!musicaCmd) { processing.delete(userId); return; }

        const vc = member?.voice?.channel;
        if (!vc) {
          await textChannel.send("❌ Debes estar en un canal de voz.");
          processing.delete(userId);
          return;
        }

        const fakeInteraction = {
          guildId, guild,
          user:    member?.user,
          member,
          channel: textChannel,
          client,
          options: {
            getSubcommand: () => "play",
            getString: (n) => n === "busqueda" ? song : null,
          },
          deferReply: async () => {},
          editReply:  async (msg) => {
            const c = typeof msg === "string" ? msg : msg.content;
            if (c) await textChannel.send(c).catch(() => {});
          },
          reply: async (msg) => {
            const c = typeof msg === "string" ? msg : msg.content;
            if (c) await textChannel.send({ content: c }).catch(() => {});
          },
          replied: false, deferred: true,
        };

        await musicaCmd.execute(fakeInteraction);
      } catch (e) {
        console.error("[Voz] Error:", e.message);
      } finally {
        processing.delete(userId);
      }
    });
  });

  console.log(`[Voz] Escucha activada en guild ${guildId}`);
}

module.exports = { startVoiceListener };
