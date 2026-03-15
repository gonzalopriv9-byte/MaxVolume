// commands/musica.js — NexaBot Music Pro ✦
// Spotify → YouTube (yt-dlp 320kbps) + Edge TTS DJ + Autocola + Preload
// Lyrics preview + Now Playing rico + Botones + Estadísticas

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType,
} = require("@discordjs/voice");
const playdl    = require("play-dl");
const { spawn } = require("child_process");
const https     = require("https");
const fs        = require("fs");
const path      = require("path");
const { createClient } = require("@supabase/supabase-js");
const { startVoiceListener } = require("../utils/voz");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const EDGE_TTS = "/home/pi/.local/bin/edge-tts";
const TMP_DIR  = "/tmp/nexabot_music";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const EMOJI = {
  CHECK:  "<a:Tick:1480638398816456848>",
  CRUZ:   "<a:CruzRoja:1480947488960806943>",
  LOGO:   "<a:NEXALOGO:1477286399345561682>",
  LOAD:   "<a:Loading:1481763726972555324>",
};

// Colores por género/mood (basado en artista)
const MOOD_COLORS = {
  default:    "#1DB954",
  autocola:   "#8B5CF6",
  reggaeton:  "#f59e0b",
  trap:       "#6366f1",
  pop:        "#ec4899",
  rock:       "#ef4444",
  electronica:"#06b6d4",
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────
const msToTime = ms => { const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
const fmtTime  = s  => { if(!s||s<0)return"0:00"; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; };

function parseDuration(dur) {
  if (!dur) return 0;
  const p = dur.split(":").map(Number);
  if (p.length===2) return p[0]*60+p[1];
  if (p.length===3) return p[0]*3600+p[1]*60+p[2];
  return 0;
}

function buildBar(elapsed, total, size=24) {
  if (!total||total<=0) return `\`[${"▓".repeat(size)}]\``;
  const pct=Math.min(elapsed/total,1), filled=Math.round(pct*size);
  const bar="▓".repeat(filled)+"░".repeat(size-filled);
  return `\`[${bar}]\` **${Math.floor(pct*100)}%**`;
}

function formatUptime(ms) {
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60), d=Math.floor(h/24);
  if (d>0) return `${d}d ${h%24}h`;
  if (h>0) return `${h}h ${m%60}m`;
  return `${m}m ${s%60}s`;
}

// Stats globales de sesión
const sessionStats = {
  songsPlayed: 0,
  totalTime:   0,  // segundos
  startTime:   Date.now(),
};

// ─────────────────────────────────────────────────────────────────────────────
// SPOTIFY
// ─────────────────────────────────────────────────────────────────────────────
let spToken=null, spExp=0;

async function spGetToken() {
  if (spToken&&Date.now()<spExp) return spToken;
  const creds=Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  return new Promise((resolve,reject)=>{
    const body="grant_type=client_credentials";
    const req=https.request({
      hostname:"accounts.spotify.com",path:"/api/token",method:"POST",
      headers:{"Authorization":`Basic ${creds}`,"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)},
    },res=>{
      let d=""; res.on("data",c=>d+=c);
      res.on("end",()=>{try{const j=JSON.parse(d);spToken=j.access_token;spExp=Date.now()+(j.expires_in-60)*1000;resolve(spToken);}catch(e){reject(e);}});
    });
    req.on("error",reject);req.write(body);req.end();
  });
}

async function spSearch(query) {
  const token=await spGetToken();
  return new Promise((resolve,reject)=>{
    https.get({
      hostname:"api.spotify.com",
      path:`/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      headers:{Authorization:`Bearer ${token}`},
    },res=>{
      let d=""; res.on("data",c=>d+=c);
      res.on("end",()=>{
        try {
          const t=JSON.parse(d)?.tracks?.items?.[0];
          if(!t) return reject(new Error("No encontrado en Spotify."));
          resolve({
            searchQuery:`${t.artists[0].name} - ${t.name}`,
            title:`${t.artists[0].name} - ${t.name}`,
            artist:t.artists[0].name,
            album:t.album.name,
            spotifyUrl:t.external_urls.spotify,
            spotifyId:t.id,
            thumbnail:t.album.images?.[0]?.url||null,
            thumbnailSmall:t.album.images?.[2]?.url||null,
            duration:msToTime(t.duration_ms),
            durationSec:Math.floor(t.duration_ms/1000),
            popularity:t.popularity||0,
            releaseYear:t.album.release_date?.slice(0,4)||"?",
          });
        } catch(e){reject(new Error("Error Spotify: "+e.message));}
      });
    }).on("error",reject);
  });
}

async function spArtistTracks(artist, exclude=new Set()) {
  const token=await spGetToken();
  return new Promise(resolve=>{
    https.get({
      hostname:"api.spotify.com",
      path:`/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=10`,
      headers:{Authorization:`Bearer ${token}`},
    },res=>{
      let d=""; res.on("data",c=>d+=c);
      res.on("end",()=>{
        try {
          const items=JSON.parse(d)?.tracks?.items||[];
          resolve(items
            .filter(t=>!exclude.has(`${t.artists[0].name} - ${t.name}`.toLowerCase()))
            .map(t=>({
              searchQuery:`${t.artists[0].name} - ${t.name}`,
              title:`${t.artists[0].name} - ${t.name}`,
              artist:t.artists[0].name,
              album:t.album.name,
              spotifyUrl:t.external_urls.spotify,
              spotifyId:t.id,
              thumbnail:t.album.images?.[0]?.url||null,
              duration:msToTime(t.duration_ms),
              durationSec:Math.floor(t.duration_ms/1000),
              popularity:t.popularity||0,
              releaseYear:t.album.release_date?.slice(0,4)||"?",
              isAutocola:true,
            }))
          );
        } catch{resolve([]);}
      });
    }).on("error",()=>resolve([]));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL
// ─────────────────────────────────────────────────────────────────────────────
async function saveHistory(guildId, userId, track) {
  try {
    await supabase.from("music_history").insert({
      guild_id:guildId, user_id:userId||null,
      title:track.title, artist:track.artist||null,
      spotify_url:track.spotifyUrl||null, spotify_id:track.spotifyId||null,
      played_at:new Date().toISOString(),
    });
  } catch {}
}

async function getHistory(guildId, limit=10) {
  try {
    const{data}=await supabase.from("music_history").select("*")
      .eq("guild_id",guildId).order("played_at",{ascending:false}).limit(limit);
    return data||[];
  } catch{return [];}
}

async function getTopTracks(guildId, limit=5) {
  try {
    const{data}=await supabase.from("music_history").select("title,artist,spotify_url")
      .eq("guild_id",guildId);
    if (!data) return [];
    const counts={};
    for (const r of data) {
      const k=r.title; counts[k]=(counts[k]||{title:r.title,artist:r.artist,url:r.spotify_url,count:0});
      counts[k].count++;
    }
    return Object.values(counts).sort((a,b)=>b.count-a.count).slice(0,limit);
  } catch{return [];}
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE TTS
// ─────────────────────────────────────────────────────────────────────────────
const DJ_PHRASES = [
  "Y como estamos de fiesta, ahora os dejo con {artist}",
  "Siguiente en la lista, {artist}! Que lo disfrutéis!",
  "Arriba el volumen, porque viene {artist}!",
  "Os traigo lo mejor de {artist}, a disfrutar!",
  "Sin parar la música, aquí viene {artist}!",
  "El público ha pedido {artist}, y aquí está!",
  "Preparaos porque viene {artist} con todo!",
  "Y continuamos con la música, ahora con {artist}!",
  "No paramos ni un segundo, siguiente {artist}!",
];
const AUTOCOLA_PHRASES = [
  "Ya que no hay más peticiones, os sugiero algo basado en vuestro historial",
  "La cola se ha vaciado, pero yo sigo aquí! Os pongo recomendaciones personalizadas",
  "Sin peticiones nuevas, me encargo yo con algo que os va a gustar",
  "Yo me encargo de la selección musical por ahora",
];

const djPhrase       = a  => DJ_PHRASES[Math.floor(Math.random()*DJ_PHRASES.length)].replace("{artist}",a);
const autocolaPhrase = () => AUTOCOLA_PHRASES[Math.floor(Math.random()*AUTOCOLA_PHRASES.length)];

async function generateTTS(text) {
  const out=path.join(TMP_DIR,`tts_${Date.now()}.mp3`);
  const safe=text.replace(/"/g,"'").replace(/\n/g," ");
  return new Promise((resolve,reject)=>{
    const p=spawn(EDGE_TTS,["--voice","es-ES-AlvaroNeural","--text",safe,"--write-media",out]);
    let err="";
    p.stderr.on("data",d=>err+=d.toString());
    p.on("error",e=>reject(new Error("edge-tts: "+e.message)));
    p.on("close",code=>{
      if (code!==0) return reject(new Error("edge-tts: "+err.trim().slice(0,100)));
      resolve(out);
    });
  });
}

function ttsToResource(mp3) {
  const ff=spawn("ffmpeg",["-i",mp3,"-af","volume=1.4","-f","s16le","-ar","48000","-ac","2","-loglevel","error","pipe:1"]);
  return createAudioResource(ff.stdout,{inputType:StreamType.Raw});
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE STREAM — 320kbps con loudnorm
// ─────────────────────────────────────────────────────────────────────────────
async function getYtUrl(ytPageUrl) {
  return new Promise((resolve,reject)=>{
    const p=spawn("yt-dlp",["--no-playlist","-f","bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio","--get-url",ytPageUrl]);
    let out="",err="";
    p.stdout.on("data",d=>out+=d.toString());
    p.stderr.on("data",d=>err+=d.toString());
    p.on("close",code=>{
      const url=out.trim().split("\n")[0];
      if (code!==0||!url) return reject(new Error("yt-dlp: "+err.trim().slice(0,100)));
      resolve(url);
    });
  });
}

function makeStream(ytUrl) {
  const ff=spawn("ffmpeg",[
    "-reconnect","1","-reconnect_streamed","1","-reconnect_delay_max","5",
    "-i",ytUrl,
    "-af","loudnorm=I=-14:TP=-1:LRA=11",
    "-f","s16le","-ar","48000","-ac","2","-b:a","320k",
    "-loglevel","error","pipe:1",
  ]);
  ff.stderr.on("data",d=>{
    const msg=d.toString().trim();
    if (!msg.includes("pull function")&&!msg.includes("Connection reset")) console.error("[ffmpeg]",msg);
  });
  ff.on("error",e=>console.error("[ffmpeg error]",e.message));
  return ff;
}

async function getStream(track) {
  if (track._preloadedUrl) {
    console.log(`[Music] ⚡ Pre-cargado: ${track.title}`);
    const ff=makeStream(track._preloadedUrl);
    if (track._preloadedThumb&&!track.thumbnail) track.thumbnail=track._preloadedThumb;
    if (track._preloadedDuration&&(!track.duration||track.duration==="?")) {
      track.duration=track._preloadedDuration;
      track.durationSec=parseDuration(track._preloadedDuration);
    }
    return{stream:ff.stdout,ffmpegProc:ff,url:track._preloadedYtUrl||"",duration:track.duration,durationSec:track.durationSec,thumbnail:track.thumbnail};
  }

  const results=await playdl.search(track.searchQuery+" official audio",{source:{youtube:"video"},limit:1});
  if (!results?.length) throw new Error("No encontrado en YouTube.");
  const video=results[0];
  const ytUrl=await getYtUrl(video.url);
  const ff=makeStream(ytUrl);
  return{stream:ff.stdout,ffmpegProc:ff,url:video.url,duration:video.durationRaw,durationSec:parseDuration(video.durationRaw),thumbnail:video.thumbnails?.[0]?.url||null};
}

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD
// ─────────────────────────────────────────────────────────────────────────────
async function preloadNext(guildId) {
  const q=queues.get(guildId);
  if (!q||!q.queue.length||q.preloading) return;
  const next=q.queue[0];
  if (next._preloaded||next._preloading) return;
  next._preloading=true; q.preloading=true;
  console.log(`[Preload] ${next.title}`);
  try {
    const ttsPromise=(q.current?.artist&&next.artist)
      ?generateTTS(djPhrase(next.artist)).then(f=>{next._ttsFile=f;}).catch(()=>{})
      :Promise.resolve();
    const ytPromise=(async()=>{
      const results=await playdl.search(next.searchQuery+" official audio",{source:{youtube:"video"},limit:1});
      if (!results?.length) return;
      const video=results[0];
      const ytUrl=await getYtUrl(video.url);
      next._preloadedUrl=ytUrl;
      next._preloadedYtUrl=video.url;
      next._preloadedDuration=video.durationRaw;
      next._preloadedThumb=video.thumbnails?.[0]?.url||null;
    })();
    await Promise.all([ttsPromise,ytPromise]);
    next._preloaded=true; next._preloading=false;
    console.log(`[Preload] ✅ ${next.title}`);
  } catch(e){console.warn(`[Preload] Falló: ${e.message}`);next._preloading=false;}
  q.preloading=false;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOTONES DE CONTROL
// ─────────────────────────────────────────────────────────────────────────────
function controlRow(paused=false, liked=false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music_skip")    .setLabel("⏭️")               .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_pause")   .setLabel(paused?"▶️":"⏸️")   .setStyle(paused?ButtonStyle.Success:ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music_stop")    .setLabel("⏹️")               .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music_vol_down").setLabel("🔉")               .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_vol_up")  .setLabel("🔊")               .setStyle(ButtonStyle.Secondary),
  );
}

function queueRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music_queue")   .setLabel("📋 Cola")          .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_shuffle") .setLabel("🔀 Mezclar")       .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_replay")  .setLabel("🔁 Repetir")       .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music_lyrics")  .setLabel("📝 Letra")         .setStyle(ButtonStyle.Secondary),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS EMBED (actualiza cada 1s) — diseño profesional
// ─────────────────────────────────────────────────────────────────────────────
function startProgress(q, track, ytUrl) {
  stopProgress(q);
  const total=track.durationSec||0;
  const t0=Date.now();
  const color=track.isAutocola?MOOD_COLORS.autocola:MOOD_COLORS.default;

  const mkEmbed=(elapsed,paused)=>new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: paused?"⏸️  Pausado":"🎵  Reproduciendo ahora", iconURL:"https://i.imgur.com/4M34hi2.png" })
    .setTitle(track.title)
    .setURL(track.spotifyUrl||ytUrl||null)
    .setThumbnail(track.thumbnail||null)
    .setDescription(
      buildBar(elapsed,total)+"\n"+
      `⏱️  \`${fmtTime(elapsed)}\` **·** \`${fmtTime(total)}\`` +
      (track.isAutocola?"\n\n🤖 *Sugerencia automática basada en tu historial*":"")
    )
    .addFields(
      { name:"👤 Solicitado por", value:track.isAutocola?"🤖 Autocola":(track.requestedBy||"—"),    inline:true },
      { name:"💿 Álbum",          value:track.album||"—",                                            inline:true },
      { name:"🔊 Volumen",        value:`${q.volume||100}%`,                                         inline:true },
      { name:"📅 Año",            value:track.releaseYear||"—",                                      inline:true },
      { name:"📋 En cola",        value:`${q.queue.length} canciones${q.queue[0]?` · siguiente: **${q.queue[0].title.split(" - ")[0]}**`:""}`, inline:true },
      { name:"⚡ Pre-cargada",    value:q.queue[0]?._preloaded?"✅ Sí":"⏳ No",                       inline:true },
    )
    .setFooter({ text:`NexaBot Music Pro  ·  320kbps  ·  ⏭️ Skip  ⏸️ Pausa  ⏹️ Stop  🔉🔊 Vol  📋 Cola  🔀 Mezclar  📝 Letra` });

  q.textChannel?.send({
    embeds:[mkEmbed(0,false)],
    components:[controlRow(false), queueRow()],
  }).then(msg=>{
    q.progressMsg=msg;
    q.progressInterval=setInterval(async()=>{
      if (!q.progressMsg) return;
      const elapsed=q.progressPaused?(q.pausedAt||0):Math.floor((Date.now()-t0)/1000);
      try {
        await msg.edit({
          embeds:[mkEmbed(elapsed,q.progressPaused)],
          components:[controlRow(q.progressPaused),queueRow()],
        });
      } catch{clearInterval(q.progressInterval);q.progressInterval=null;}
    },1000);
  }).catch(()=>{});
}

function stopProgress(q) {
  if (q.progressInterval){clearInterval(q.progressInterval);q.progressInterval=null;}
  if (q.progressMsg){q.progressMsg.delete().catch(()=>{});q.progressMsg=null;}
  q.progressPaused=false;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOCOLA
// ─────────────────────────────────────────────────────────────────────────────
async function getBlockedArtists(guildId) {
  try {
    // Limpiar expirados
    await supabase.from("blocked_artists").delete()
      .eq("guild_id", guildId)
      .lt("expires_at", new Date().toISOString());
    const { data } = await supabase.from("blocked_artists")
      .select("artist").eq("guild_id", guildId);
    return new Set((data||[]).map(b=>b.artist.toLowerCase()));
  } catch { return new Set(); }
}

async function fillAutocola(guildId,queue) {
  try {
    const history=await getHistory(guildId,10);
    if (!history.length) return false;

    const blockedArtists=await getBlockedArtists(guildId);

    // Filtrar artistas bloqueados del historial
    const artists=[...new Set(
      history.filter(h=>h.artist&&!blockedArtists.has(h.artist.toLowerCase())).map(h=>h.artist)
    )];
    if (!artists.length) {
      console.log("[Autocola] Todos los artistas del historial están bloqueados");
      return false;
    }

    const exclude=new Set(history.map(h=>h.title?.toLowerCase()));
    for (const t of queue) exclude.add(t.title?.toLowerCase());

    // Intentar hasta 3 artistas distintos por si todos dan canciones excluidas
    for (let attempt=0; attempt<3; attempt++) {
      const artist=artists[Math.floor(Math.random()*Math.min(artists.length,5))];
      const tracks=await spArtistTracks(artist,exclude);

      // Filtrar también canciones de artistas bloqueados en las recomendaciones
      const filtered=tracks.filter(t=>!blockedArtists.has(t.artist?.toLowerCase()));
      if (!filtered.length) continue;

      const pick=filtered[Math.floor(Math.random()*filtered.length)];
      console.log(`[Autocola] → ${pick.title}`);
      queue.push(pick);
      return true;
    }
    return false;
  } catch(e){console.error("[Autocola]",e.message);return false;}
}

// ─────────────────────────────────────────────────────────────────────────────
// COLA DE REPRODUCCIÓN
// ─────────────────────────────────────────────────────────────────────────────
const queues=new Map();

async function playNext(guildId,client) {
  const q=queues.get(guildId);
  if (!q||q.playingTTS) return;

  if (!q.queue.length) {
    const filled=await fillAutocola(guildId,q.queue);
    if (!filled||!q.queue.length) {
      stopProgress(q);
      q.textChannel?.send({embeds:[new EmbedBuilder()
        .setColor("#1DB954").setTitle("✅ Cola terminada")
        .setDescription("No hay más canciones en la cola.\nUsa `/musica play` para continuar o activa la autocola.")
        .setFooter({text:"NexaBot Music Pro"})
      ]}).catch(()=>{});
      try{q.connection?.destroy();}catch{}
      queues.delete(guildId);
      return;
    }
  }

  const next=q.queue[0];
  if (q.current&&next.artist) {
    await doTTS(q,next._ttsFile||null,next._ttsText||djPhrase(next.artist),guildId,client);
  } else {
    await playTrack(guildId,client);
  }
}

async function doTTS(q,preloadedFile,text,guildId,client) {
  console.log(`[DJ] "${text}"`);
  q.playingTTS=true;
  stopProgress(q);

  // Pausar música actual mientras habla el DJ
  const wasPlaying=q.player.state.status===AudioPlayerStatus.Playing;
  if (wasPlaying) q.player.pause();

  try {
    const ttsFile=preloadedFile||await generateTTS(text);
    if (!ttsFile){
      if (wasPlaying) q.player.unpause();
      q.playingTTS=false;
      await playTrack(guildId,client);
      return;
    }

    // Reanudar para reproducir TTS
    if (wasPlaying) q.player.unpause();
    const resource=ttsToResource(ttsFile);
    q.player.play(resource);

    q.player.once(AudioPlayerStatus.Idle,async()=>{
      q.playingTTS=false;
      try{fs.unlinkSync(ttsFile);}catch{}
      await playTrack(guildId,client);
    });
  } catch(e){
    console.error("[DJ]",e.message);
    q.playingTTS=false;
    await playTrack(guildId,client);
  }
}

async function playTrack(guildId,client) {
  const q=queues.get(guildId);
  if (!q||!q.queue.length){
    if (q){try{q.connection?.destroy();}catch{}queues.delete(guildId);}
    return;
  }

  // Modo repetición
  if (q.repeatMode&&q.current) {
    q.queue.unshift({...q.current, _preloaded:false, _preloadedUrl:null, _ttsFile:null});
  }

  const track=q.queue.shift();
  q.current=track;
  if (q.safetyTimeout){clearTimeout(q.safetyTimeout);q.safetyTimeout=null;}

  try {
    const yt=await getStream(track);
    if (!track.thumbnail)   track.thumbnail=yt.thumbnail;
    if (!track.duration||track.duration==="?") track.duration=yt.duration;
    if (!track.durationSec||track.durationSec===0) track.durationSec=yt.durationSec;

    q.currentFfmpeg=yt.ffmpegProc;
    q.trackStartTime=Date.now();

    const resource=createAudioResource(yt.stream,{inputType:StreamType.Raw});
    q.player.play(resource);

    await saveHistory(guildId,track.requestedById||null,track);
    sessionStats.songsPlayed++;
    startProgress(q,track,yt.url);

    if (track.durationSec>0) {
      q.safetyTimeout=setTimeout(()=>{
        const q2=queues.get(guildId);
        if (q2&&!q2.playingTTS){stopProgress(q2);playNext(guildId,client);}
      },(track.durationSec+25)*1000);
    }

    setTimeout(()=>preloadNext(guildId),3000);
    console.log(`[Music] ▶️ ${track.title}${track.isAutocola?" 🤖":""}`);

  } catch(e){
    console.error(`[Music] Error: ${e.message}`);
    q.textChannel?.send({content:`❌ Error con **${track.title}**: ${e.message}`}).catch(()=>{});
    setTimeout(()=>playTrack(guildId,client),1500);
  }
}

async function enqueue(guildId,voiceChannel,textChannel,track,client) {
  let q=queues.get(guildId);

  if (!q) {
    const connection=joinVoiceChannel({
      channelId:voiceChannel.id,guildId,
      adapterCreator:voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:false,selfMute:false,
    });
    try{
      await entersState(connection,VoiceConnectionStatus.Ready,15_000);
      console.log("[Music] Conexión lista ✅");
    }catch(e){connection.destroy();throw new Error("No se pudo conectar: "+e.message);}

    const player=createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle,()=>{
      const q2=queues.get(guildId);
      if (!q2) return;
      if (q2.safetyTimeout){clearTimeout(q2.safetyTimeout);q2.safetyTimeout=null;}
      if (!q2.playingTTS){stopProgress(q2);playNext(guildId,client);}
    });
    player.on(AudioPlayerStatus.AutoPaused,()=>console.log("[Music] AutoPaused — ignorado"));
    player.on(AudioPlayerStatus.Playing,  ()=>console.log("[Music] ▶️ Playing"));
    player.on(AudioPlayerStatus.Buffering,()=>console.log("[Music] ⏳ Buffering..."));
    player.on("error",err=>{
      console.error("[Music] Player error:",err.message);
      const q2=queues.get(guildId);
      if (q2){q2.playingTTS=false;stopProgress(q2);if(q2.safetyTimeout)clearTimeout(q2.safetyTimeout);}
      setTimeout(()=>playTrack(guildId,client),1000);
    });
    connection.on(VoiceConnectionStatus.Disconnected,async()=>{
      try{await Promise.race([entersState(connection,VoiceConnectionStatus.Signalling,5_000),entersState(connection,VoiceConnectionStatus.Connecting,5_000)]);}
      catch{const q2=queues.get(guildId);if(q2){stopProgress(q2);if(q2.safetyTimeout)clearTimeout(q2.safetyTimeout);}connection.destroy();queues.delete(guildId);}
    });

    q={
      connection,player,queue:[track],current:null,textChannel,
      playingTTS:false,progressMsg:null,progressInterval:null,
      progressPaused:false,pausedAt:0,safetyTimeout:null,
      currentFfmpeg:null,volume:100,trackStartTime:0,
      preloading:false,repeatMode:false,
    };
    queues.set(guildId,q);

    // Activar reconocimiento de voz
    try{startVoiceListener(connection,textChannel,client,guildId);}
    catch(e){console.warn("[Voz] No se pudo activar:",e.message);}

    await playTrack(guildId,client);
  } else {
    if (!track.isAutocola) {
      const fi=q.queue.findIndex(t=>t.isAutocola);
      fi!==-1?q.queue.splice(fi,0,track):q.queue.push(track);
    } else {
      q.queue.push(track);
    }
    q.textChannel=textChannel;
    const pos=q.queue.indexOf(track)+1;
    textChannel.send({embeds:[new EmbedBuilder()
      .setColor("#1DB954")
      .setAuthor({name:"➕  Añadido a la cola"})
      .setTitle(track.title)
      .setURL(track.spotifyUrl||null)
      .setThumbnail(track.thumbnailSmall||track.thumbnail||null)
      .addFields(
        {name:"⏱️ Duración", value:track.duration||"?",    inline:true},
        {name:"📋 Posición",  value:`#${pos}`,               inline:true},
        {name:"💿 Álbum",     value:track.album||"—",        inline:true},
      )
      .setFooter({text:"NexaBot Music Pro"})
    ]}).catch(()=>{});
    if (pos===1) setTimeout(()=>preloadNext(guildId),500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER DE BOTONES
// ─────────────────────────────────────────────────────────────────────────────
async function handleMusicButton(interaction) {
  const q=queues.get(interaction.guildId);
  if (!q) return interaction.reply({content:"❌ No hay música reproduciéndose.",flags:64});
  const id=interaction.customId;
  const isAdmin=interaction.member?.permissions?.has("Administrator");

  if (id==="music_skip") {
    const cur=q.current;
    if (!cur) return interaction.reply({content:"❌ No hay canción activa.",flags:64});
    if (!cur.isAutocola&&cur.requestedById&&cur.requestedById!==interaction.user.id&&!isAdmin)
      return interaction.reply({content:`❌ Solo <@${cur.requestedById}> o un admin puede saltar.`,flags:64});
    stopProgress(q);
    if (q.safetyTimeout){clearTimeout(q.safetyTimeout);q.safetyTimeout=null;}
    q.player.stop();
    return interaction.reply({content:`⏭️ Saltada por ${interaction.user}.`,flags:64});
  }

  if (id==="music_pause") {
    if (q.progressPaused){
      q.player.unpause();q.progressPaused=false;
      return interaction.reply({content:"▶️ Reanudada.",flags:64});
    } else {
      q.player.pause();q.progressPaused=true;
      q.pausedAt=Math.floor((Date.now()-q.trackStartTime)/1000);
      return interaction.reply({content:"⏸️ Pausada.",flags:64});
    }
  }

  if (id==="music_stop") {
    if (!isAdmin&&q.current?.requestedById!==interaction.user.id)
      return interaction.reply({content:"❌ Solo un admin puede parar.",flags:64});
    stopProgress(q);
    if (q.safetyTimeout){clearTimeout(q.safetyTimeout);q.safetyTimeout=null;}
    q.queue=[];q.player.stop();
    try{q.connection.destroy();}catch{}
    queues.delete(interaction.guildId);
    return interaction.reply({content:"⏹️ Música detenida.",flags:64});
  }

  if (id==="music_vol_up"){q.volume=Math.min((q.volume||100)+10,200);return interaction.reply({content:`🔊 Volumen: **${q.volume}%**`,flags:64});}
  if (id==="music_vol_down"){q.volume=Math.max((q.volume||100)-10,10);return interaction.reply({content:`🔉 Volumen: **${q.volume}%**`,flags:64});}

  if (id==="music_queue") {
    const lista=[
      q.current?`▶️ **${q.current.title}** \`${q.current.duration||"?"}\`${q.current.isAutocola?" 🤖":""}`:"(ninguna)",
      ...q.queue.slice(0,10).map((t,i)=>`${i+1}. **${t.title}** \`${t.duration||"?"}\`${t.isAutocola?" 🤖":""}${t._preloaded?" ⚡":""}`)
    ].join("\n");
    return interaction.reply({embeds:[new EmbedBuilder()
      .setColor("#1DB954").setTitle("📋 Cola de reproducción").setDescription(lista||"Vacía.")
      .addFields(
        {name:"📋 Total",   value:`${q.queue.length+(q.current?1:0)}`,inline:true},
        {name:"🤖 Autocola",value:`${q.queue.filter(t=>t.isAutocola).length}`,inline:true},
        {name:"🔁 Repetir", value:q.repeatMode?"✅ Activado":"❌ Off",inline:true},
      )
      .setFooter({text:"⚡ = pre-cargada  ·  🤖 = autocola  ·  NexaBot Music Pro"})
    ],flags:64});
  }

  if (id==="music_shuffle") {
    const ac=q.queue.filter(t=>t.isAutocola);
    const manual=q.queue.filter(t=>!t.isAutocola);
    manual.sort(()=>Math.random()-0.5);
    q.queue=[...manual,...ac];
    return interaction.reply({content:"🔀 Cola mezclada.",flags:64});
  }

  if (id==="music_replay") {
    q.repeatMode=!q.repeatMode;
    return interaction.reply({content:q.repeatMode?"🔁 Repetición activada.":"🔁 Repetición desactivada.",flags:64});
  }

  if (id==="music_lyrics") {
    const cur=q.current;
    if (!cur) return interaction.reply({content:"❌ No hay canción activa.",flags:64});
    return interaction.reply({embeds:[new EmbedBuilder()
      .setColor("#1DB954").setTitle("📝 Letra")
      .setDescription(`Para ver la letra de **${cur.title}** visita:\n[Genius.com](https://genius.com/search?q=${encodeURIComponent(cur.title)})\n[AZLyrics](https://www.azlyrics.com/)`)
      .setFooter({text:"NexaBot Music Pro no reproduce letras por derechos de autor"})
    ],flags:64});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SLASH COMMAND
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  setupPlayer:async()=>{},
  handleMusicButton,

  data:new SlashCommandBuilder()
    .setName("musica").setDescription("🎵 NexaBot Music Pro")
    .addSubcommand(s=>s.setName("play").setDescription("Reproduce una canción")
      .addStringOption(o=>o.setName("busqueda").setDescription("Artista o canción").setRequired(true)))
    .addSubcommand(s=>s.setName("pause")    .setDescription("Pausa la reproducción"))
    .addSubcommand(s=>s.setName("resume")   .setDescription("Reanuda la reproducción"))
    .addSubcommand(s=>s.setName("skip")     .setDescription("Salta la canción actual"))
    .addSubcommand(s=>s.setName("stop")     .setDescription("Para y vacía la cola"))
    .addSubcommand(s=>s.setName("cola")     .setDescription("Muestra la cola"))
    .addSubcommand(s=>s.setName("historial").setDescription("Últimas canciones reproducidas"))
    .addSubcommand(s=>s.setName("stats")    .setDescription("Estadísticas de música del servidor"))
    .addSubcommand(s=>s.setName("top")      .setDescription("Top canciones más reproducidas"))
    .addSubcommand(s=>s.setName("repetir")  .setDescription("Activa/desactiva repetición de la canción actual"))
    .addSubcommand(s=>s.setName("mezclar")  .setDescription("Mezcla aleatoriamente la cola"))
    .addSubcommand(s=>s.setName("volumen")  .setDescription("Cambia el volumen (10-200)")
      .addIntegerOption(o=>o.setName("nivel").setDescription("Volumen").setRequired(true).setMinValue(10).setMaxValue(200))),

  async execute(interaction) {
    const sub=interaction.options.getSubcommand();
    const client=interaction.client;

    // ── PLAY ──
    if (sub==="play") {
      const vc=interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({content:"❌ Debes estar en un canal de voz.",flags:64});
      await interaction.deferReply();
      const busqueda=interaction.options.getString("busqueda");
      try {
        let track;
        try{track=await spSearch(busqueda);}
        catch{track={searchQuery:busqueda,title:busqueda,artist:busqueda.split("-")[0]?.trim()||busqueda,album:"—",spotifyUrl:null,spotifyId:null,thumbnail:null,duration:"?",durationSec:0,popularity:0,releaseYear:"?"};}
        track.requestedBy=interaction.user.toString();
        track.requestedById=interaction.user.id;

        const q=queues.get(interaction.guildId);
        if (q) {
          const norm=track.title.toLowerCase();
          if (q.queue.some(t=>t.title.toLowerCase()===norm)||q.current?.title?.toLowerCase()===norm)
            return interaction.editReply({content:`⚠️ **${track.title}** ya está en la cola.`});
        }

        await enqueue(interaction.guildId,vc,interaction.channel,track,client);
        await interaction.editReply({content:`${EMOJI.CHECK} Buscando **${track.title}**...`});
      } catch(e){
        console.error("[Music] Error play:",e.message);
        await interaction.editReply({content:`❌ Error: ${e.message}`});
      }
      return;
    }

    // ── STATS ──
    if (sub==="stats") {
      const hist=await getHistory(interaction.guildId,100);
      const uniqueArtists=new Set(hist.map(h=>h.artist).filter(Boolean));
      const uptime=formatUptime(Date.now()-sessionStats.startTime);
      const q=queues.get(interaction.guildId);

      return interaction.reply({embeds:[new EmbedBuilder()
        .setColor("#1DB954")
        .setTitle("📊 Estadísticas de Música")
        .setDescription("Resumen de actividad musical del servidor")
        .addFields(
          {name:"🎵 Canciones (sesión)",  value:`${sessionStats.songsPlayed}`,       inline:true},
          {name:"📜 Canciones (historial)",value:`${hist.length}`,                    inline:true},
          {name:"🎤 Artistas únicos",      value:`${uniqueArtists.size}`,             inline:true},
          {name:"⏱️ Uptime del bot",       value:uptime,                              inline:true},
          {name:"📋 Cola actual",          value:`${q?.queue.length||0} canciones`,   inline:true},
          {name:"🔁 Modo repetir",         value:q?.repeatMode?"✅ On":"❌ Off",       inline:true},
        )
        .setFooter({text:"NexaBot Music Pro  ·  Estadísticas en tiempo real"})
        .setTimestamp()
      ]});
    }

    // ── TOP ──
    if (sub==="top") {
      const top=await getTopTracks(interaction.guildId,10);
      if (!top.length) return interaction.reply({content:"📭 No hay suficiente historial.",flags:64});
      const lista=top.map((t,i)=>`${["🥇","🥈","🥉"][i]||`\`${i+1}.\``} **${t.title}** — ${t.count} veces`).join("\n");
      return interaction.reply({embeds:[new EmbedBuilder()
        .setColor("#f59e0b").setTitle("🏆 Top Canciones del Servidor")
        .setDescription(lista)
        .setFooter({text:"NexaBot Music Pro"})
      ]});
    }

    // ── HISTORIAL ──
    if (sub==="historial") {
      const hist=await getHistory(interaction.guildId,10);
      if (!hist.length) return interaction.reply({content:"📭 No hay historial.",flags:64});
      const lista=hist.map((h,i)=>`${i+1}. **${h.title}** — <t:${Math.floor(new Date(h.played_at).getTime()/1000)}:R>`).join("\n");
      return interaction.reply({embeds:[new EmbedBuilder()
        .setColor("#1DB954").setTitle("📜 Historial de Música")
        .setDescription(lista)
        .setFooter({text:"NexaBot Music Pro  ·  Últimas 10 canciones"})
      ]});
    }

    const q=queues.get(interaction.guildId);
    if (!q) return interaction.reply({content:"❌ No hay música reproduciéndose.",flags:64});

    if (sub==="pause"){q.player.pause();q.progressPaused=true;return interaction.reply({content:"⏸️ Pausada."});}
    if (sub==="resume"){q.player.unpause();q.progressPaused=false;return interaction.reply({content:"▶️ Reanudada."});}

    if (sub==="repetir"){
      q.repeatMode=!q.repeatMode;
      return interaction.reply({content:q.repeatMode?"🔁 Repetición **activada** — la canción actual se repetirá.":"🔁 Repetición **desactivada**."});
    }

    if (sub==="mezclar"){
      const ac=q.queue.filter(t=>t.isAutocola);
      const manual=q.queue.filter(t=>!t.isAutocola);
      manual.sort(()=>Math.random()-0.5);
      q.queue=[...manual,...ac];
      return interaction.reply({content:`🔀 Cola mezclada. ${q.queue.length} canciones reordenadas.`});
    }

    if (sub==="skip") {
      const isAdmin=interaction.member?.permissions?.has("Administrator");
      const cur=q.current;
      if (!cur) return interaction.reply({content:"❌ No hay canción activa.",flags:64});
      if (!cur.isAutocola&&cur.requestedById&&cur.requestedById!==interaction.user.id&&!isAdmin)
        return interaction.reply({content:`❌ Solo <@${cur.requestedById}> puede saltar.`,flags:64});
      stopProgress(q);
      if (q.safetyTimeout){clearTimeout(q.safetyTimeout);q.safetyTimeout=null;}
      q.player.stop();
      return interaction.reply({content:"⏭️ Canción saltada."});
    }

    if (sub==="stop"){
      const isAdmin=interaction.member?.permissions?.has("Administrator");
      if (!isAdmin&&q.current?.requestedById!==interaction.user.id)
        return interaction.reply({content:"❌ Solo un admin puede parar.",flags:64});
      stopProgress(q);
      if (q.safetyTimeout){clearTimeout(q.safetyTimeout);q.safetyTimeout=null;}
      q.queue=[];q.player.stop();
      try{q.connection.destroy();}catch{}
      queues.delete(interaction.guildId);
      return interaction.reply({content:"⏹️ Música detenida."});
    }

    if (sub==="cola"){
      const acCount=q.queue.filter(t=>t.isAutocola).length;
      const lista=[
        q.current?`▶️ **${q.current.title}** \`${q.current.duration||"?"}\`${q.current.isAutocola?" 🤖":""}`:"(ninguna)",
        ...q.queue.slice(0,10).map((t,i)=>`${i+1}. **${t.title}** \`${t.duration||"?"}\`${t.isAutocola?" 🤖":""}${t._preloaded?" ⚡":""}`)
      ].join("\n");
      return interaction.reply({embeds:[new EmbedBuilder()
        .setColor("#1DB954").setTitle("🎵 Cola de reproducción").setDescription(lista||"Vacía.")
        .addFields(
          {name:"📋 Total",   value:`${q.queue.length+(q.current?1:0)}`,inline:true},
          {name:"🤖 Autocola",value:`${acCount}`,inline:true},
          {name:"🔊 Volumen", value:`${q.volume||100}%`,inline:true},
          {name:"🔁 Repetir", value:q.repeatMode?"✅ On":"❌ Off",inline:true},
        )
        .setFooter({text:"⚡ = pre-cargada  ·  🤖 = autocola  ·  NexaBot Music Pro"})
      ]});
    }

    if (sub==="volumen"){
      q.volume=interaction.options.getInteger("nivel");
      return interaction.reply({content:`🔊 Volumen: **${q.volume}%** (próxima canción)`});
    }
  },
};
