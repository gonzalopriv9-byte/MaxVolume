// utils/voz.js — Reconocimiento de voz para comandos
// Escucha "Hey Puti pon [canción]" en el canal de voz

const {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const { spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");

const TMP_DIR = "/tmp/nexabot_voice";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Palabras clave de activación
const WAKE_WORDS = ["hey puti", "ei puti", "hey putis", "oye puti"];

// Usuarios que ya están siendo procesados (evitar duplicados)
const processing = new Set();

// Convierte opus a wav y luego transcribe con Google STT
async function transcribe(pcmFile) {
  return new Promise((resolve) => {
    const wavFile = pcmFile.replace(".pcm", ".wav");

    // Convertir PCM a WAV
    const ff = spawn("ffmpeg", [
      "-f", "s16le", "-ar", "48000", "-ac", "1",
      "-i", pcmFile,
      "-ar", "16000",
      "-y", wavFile,
      "-loglevel", "error",
    ]);

    ff.on("close", () => {
      if (!fs.existsSync(wavFile)) { resolve(null); return; }

      // Transcribir con Python + SpeechRecognition
      const py = spawn("python3", ["-c", `
import speech_recognition as sr
r = sr.Recognizer()
with sr.AudioFile('${wavFile}') as source:
    audio = r.record(source)
try:
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

// Extraer nombre de canción del texto transcrito
function extractSong(text) {
  for (const wake of WAKE_WORDS) {
    const idx = text.indexOf(wake);
    if (idx !== -1) {
      // Buscar "pon" después de la wake word
      const after = text.slice(idx + wake.length).trim();
      const ponMatch = after.match(/^(?:pon|poner|ponme|pone)\s+(.+)$/i);
      if (ponMatch) return ponMatch[1].trim();
      // Si no hay "pon", tomar todo lo que viene después
      if (after.length > 2) return after;
    }
  }
  return null;
}

// Iniciar escucha en un canal de voz
function startVoiceListener(connection, textChannel, client, guildId) {
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (processing.has(userId)) return;
    processing.add(userId);

    const pcmFile = path.join(TMP_DIR, `voice_${userId}_${Date.now()}.pcm`);
    const fileStream = fs.createWriteStream(pcmFile);

    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000, // 1s de silencio para cortar
      },
    });

    // Decodificar opus a PCM
    const ffmpeg = spawn("ffmpeg", [
      "-f", "opus", "-i", "pipe:0",
      "-f", "s16le", "-ar", "48000", "-ac", "1",
      "-loglevel", "error",
      "pipe:1",
    ]);

    audioStream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(fileStream);

    ffmpeg.on("error", () => { processing.delete(userId); });

    fileStream.on("finish", async () => {
      try {
        const stats = fs.statSync(pcmFile);
        // Ignorar clips muy cortos (menos de 0.5s)
        if (stats.size < 48000) {
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

        // Buscar al miembro que habló
        const guild  = client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId);
        const name   = member?.displayName || "alguien";

        // Notificar en el canal de texto
        await textChannel.send(`🎤 **${name}** ha pedido: **${song}**`);

        // Ejecutar como si fuera un slash command de música
        const musicaCmd = client.commands.get("musica");
        if (musicaCmd) {
          // Simular la petición de canción
          const vc = member?.voice?.channel;
          if (!vc) {
            await textChannel.send("❌ Debes estar en un canal de voz para pedir canciones.");
            processing.delete(userId);
            return;
          }

          // Importar función de búsqueda de Spotify y enqueue
          // Usamos el execute del comando directamente con un objeto simulado
          try {
            const fakeInteraction = {
              guildId,
              guild,
              user:    member?.user,
              member,
              channel: textChannel,
              client,
              options: {
                getSubcommand: () => "play",
                getString:     (name) => name === "busqueda" ? song : null,
              },
              deferReply: async () => {},
              editReply:  async (msg) => {
                if (typeof msg === "string") await textChannel.send(msg);
                else if (msg.content) await textChannel.send(msg.content);
              },
              reply: async (msg) => {
                if (typeof msg === "string") await textChannel.send(msg);
                else if (msg.content) await textChannel.send({ content: msg.content });
              },
              replied:  false,
              deferred: true,
            };

            await musicaCmd.execute(fakeInteraction);
          } catch (e) {
            console.error("[Voz] Error ejecutando musica:", e.message);
            await textChannel.send(`❌ Error al poner la canción: ${e.message}`);
          }
        }

      } catch (e) {
        console.error("[Voz] Error procesando audio:", e.message);
      } finally {
        processing.delete(userId);
      }
    });
  });

  console.log(`[Voz] Escucha activada en guild ${guildId}`);
}

module.exports = { startVoiceListener };
