// commands/playlist.js — Sistema de playlists personales y de servidor

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const https = require("https");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const EMOJI = {
  CHECK: "<a:Tick:1480638398816456848>",
  CRUZ:  "<a:CruzRoja:1480947488960806943>",
};

// ─── SUPABASE HELPERS ────────────────────────────────────────────────────────
async function getPlaylist(id) {
  const { data } = await supabase.from("playlists").select("*").eq("id", id).single();
  return data;
}

async function getUserPlaylists(userId, guildId) {
  const { data } = await supabase.from("playlists").select("*")
    .or(`owner_id.eq.${userId},and(is_server.eq.true,guild_id.eq.${guildId})`)
    .order("created_at", { ascending: false });
  return data || [];
}

async function getPlaylistTracks(playlistId) {
  const { data } = await supabase.from("playlist_tracks").select("*")
    .eq("playlist_id", playlistId).order("position", { ascending: true });
  return data || [];
}

// ─── SPOTIFY ─────────────────────────────────────────────────────────────────
let spToken = null, spExp = 0;

async function spGetToken() {
  if (spToken && Date.now() < spExp) return spToken;
  const creds = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  return new Promise((resolve, reject) => {
    const body = "grant_type=client_credentials";
    const req  = https.request({
      hostname: "accounts.spotify.com", path: "/api/token", method: "POST",
      headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { const j = JSON.parse(d); spToken = j.access_token; spExp = Date.now()+(j.expires_in-60)*1000; resolve(spToken); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

async function spSearch(query) {
  const token = await spGetToken();
  return new Promise((resolve, reject) => {
    https.get({
      hostname: "api.spotify.com",
      path: `/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      headers: { Authorization: `Bearer ${token}` },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const t = JSON.parse(d)?.tracks?.items?.[0];
          if (!t) return reject(new Error("No encontrado."));
          const s = Math.floor(t.duration_ms/1000);
          resolve({
            title:      `${t.artists[0].name} - ${t.name}`,
            artist:     t.artists[0].name,
            spotifyUrl: t.external_urls.spotify,
            spotifyId:  t.id,
            duration:   `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`,
          });
        } catch(e) { reject(new Error("Error Spotify: "+e.message)); }
      });
    }).on("error", reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Gestiona tus playlists de música")
    .addSubcommand(s => s.setName("crear").setDescription("Crea una nueva playlist")
      .addStringOption(o => o.setName("nombre").setDescription("Nombre de la playlist").setRequired(true))
      .addBooleanOption(o => o.setName("servidor").setDescription("Playlist del servidor (todos pueden usarla)")))
    .addSubcommand(s => s.setName("anadir").setDescription("Añade una canción a una playlist")
      .addIntegerOption(o => o.setName("id").setDescription("ID de la playlist").setRequired(true))
      .addStringOption(o => o.setName("cancion").setDescription("Nombre de la canción").setRequired(true)))
    .addSubcommand(s => s.setName("eliminar_cancion").setDescription("Elimina una canción de una playlist")
      .addIntegerOption(o => o.setName("playlist_id").setDescription("ID de la playlist").setRequired(true))
      .addIntegerOption(o => o.setName("track_id").setDescription("ID de la canción (ver con /playlist ver)").setRequired(true)))
    .addSubcommand(s => s.setName("ver").setDescription("Ver las canciones de una playlist")
      .addIntegerOption(o => o.setName("id").setDescription("ID de la playlist").setRequired(true)))
    .addSubcommand(s => s.setName("mis_playlists").setDescription("Ver tus playlists y las del servidor"))
    .addSubcommand(s => s.setName("reproducir").setDescription("Reproduce una playlist completa")
      .addIntegerOption(o => o.setName("id").setDescription("ID de la playlist").setRequired(true))
      .addBooleanOption(o => o.setName("mezclar").setDescription("Orden aleatorio")))
    .addSubcommand(s => s.setName("eliminar").setDescription("Elimina una playlist")
      .addIntegerOption(o => o.setName("id").setDescription("ID de la playlist").setRequired(true)))
    .addSubcommand(s => s.setName("compartir").setDescription("Comparte una playlist con otro usuario")
      .addIntegerOption(o => o.setName("id").setDescription("ID de la playlist").setRequired(true))
      .addUserOption(o => o.setName("usuario").setDescription("Usuario con quien compartir").setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── CREAR ──
    if (sub === "crear") {
      const nombre   = interaction.options.getString("nombre");
      const isServer = interaction.options.getBoolean("servidor") || false;
      if (isServer && !interaction.member.permissions.has("ManageGuild"))
        return interaction.reply({ content: `${EMOJI.CRUZ} Necesitas **Gestionar servidor** para crear playlists del servidor.`, flags: 64 });

      const { data, error } = await supabase.from("playlists").insert({
        name: nombre, owner_id: interaction.user.id,
        guild_id: interaction.guildId, is_server: isServer,
      }).select().single();

      if (error) return interaction.reply({ content: `${EMOJI.CRUZ} Error: ${error.message}`, flags: 64 });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle("✅ Playlist creada")
        .addFields(
          { name: "📋 Nombre", value: nombre,           inline: true },
          { name: "🆔 ID",     value: `\`${data.id}\``, inline: true },
          { name: "🌐 Tipo",   value: isServer ? "Servidor 🌐" : "Personal 👤", inline: true },
        )
        .setDescription(`Añade canciones con \`/playlist anadir id:${data.id} cancion:[nombre]\``)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── AÑADIR ──
    if (sub === "anadir") {
      const plId  = interaction.options.getInteger("id");
      const query = interaction.options.getString("cancion");
      await interaction.deferReply();

      const pl = await getPlaylist(plId);
      if (!pl) return interaction.editReply({ content: `${EMOJI.CRUZ} Playlist \`${plId}\` no encontrada.` });
      if (pl.owner_id !== interaction.user.id)
        return interaction.editReply({ content: `${EMOJI.CRUZ} No tienes permiso para editar esta playlist.` });

      try {
        const track = await spSearch(query);
        const { data: last } = await supabase.from("playlist_tracks").select("position")
          .eq("playlist_id", plId).order("position", { ascending: false }).limit(1);
        const pos = (last?.[0]?.position || 0) + 1;

        await supabase.from("playlist_tracks").insert({
          playlist_id: plId, title: track.title, artist: track.artist,
          spotify_url: track.spotifyUrl, spotify_id: track.spotifyId,
          duration: track.duration, added_by: interaction.user.id, position: pos,
        });

        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor("#1DB954").setTitle("➕ Canción añadida")
          .setDescription(`**${track.title}** añadida a **${pl.name}**`)
          .addFields(
            { name: "⏱️ Duración", value: track.duration||"?", inline: true },
            { name: "📋 Posición", value: `#${pos}`,            inline: true },
          )
          .setFooter({ text: "NexaBot Music Pro" })
        ]});
      } catch(e) {
        return interaction.editReply({ content: `${EMOJI.CRUZ} Error: ${e.message}` });
      }
    }

    // ── ELIMINAR CANCIÓN ──
    if (sub === "eliminar_cancion") {
      const plId    = interaction.options.getInteger("playlist_id");
      const trackId = interaction.options.getInteger("track_id");
      const pl = await getPlaylist(plId);
      if (!pl) return interaction.reply({ content: `${EMOJI.CRUZ} Playlist no encontrada.`, flags: 64 });
      if (pl.owner_id !== interaction.user.id)
        return interaction.reply({ content: `${EMOJI.CRUZ} No tienes permiso.`, flags: 64 });

      const { data: track } = await supabase.from("playlist_tracks").select("title")
        .eq("id", trackId).eq("playlist_id", plId).single();
      if (!track) return interaction.reply({ content: `${EMOJI.CRUZ} Canción \`${trackId}\` no encontrada.`, flags: 64 });

      await supabase.from("playlist_tracks").delete().eq("id", trackId);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#ef4444").setTitle("🗑️ Canción eliminada")
        .setDescription(`**${track.title}** eliminada de **${pl.name}**`)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── VER ──
    if (sub === "ver") {
      const plId = interaction.options.getInteger("id");
      const pl   = await getPlaylist(plId);
      if (!pl) return interaction.reply({ content: `${EMOJI.CRUZ} Playlist no encontrada.`, flags: 64 });

      const tracks = await getPlaylistTracks(plId);
      if (!tracks.length) return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle(`📋 ${pl.name}`).setDescription("Playlist vacía. Usa `/playlist anadir` para añadir canciones.")
      ]});

      const lista = tracks.map((t,i) => `\`${t.id}\` ${i+1}. **${t.title}** \`${t.duration||"?"}\``).join("\n");
      const totalSecs = tracks.reduce((acc,t) => {
        if (!t.duration) return acc;
        const p = t.duration.split(":").map(Number);
        return acc + (p.length===2 ? p[0]*60+p[1] : 0);
      }, 0);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954")
        .setTitle(`📋 ${pl.name} ${pl.is_server?"🌐":"👤"}`)
        .setDescription(lista.slice(0, 4000))
        .addFields(
          { name: "🎵 Canciones", value: `${tracks.length}`,  inline: true },
          { name: "⏱️ Total",     value: `${Math.floor(totalSecs/60)}:${String(totalSecs%60).padStart(2,"0")}`, inline: true },
          { name: "🆔 ID",        value: `\`${plId}\``,        inline: true },
        )
        .setFooter({ text: "El número al inicio de cada línea es el ID para eliminar  •  NexaBot Music Pro" })
      ]});
    }

    // ── MIS PLAYLISTS ──
    if (sub === "mis_playlists") {
      const playlists = await getUserPlaylists(interaction.user.id, interaction.guildId);
      if (!playlists.length) return interaction.reply({
        content: "📭 No tienes playlists aún. Usa `/playlist crear` para empezar.", flags: 64
      });

      const personal = playlists.filter(p => !p.is_server && p.owner_id===interaction.user.id);
      const servidor = playlists.filter(p => p.is_server);
      const fmt = l => l.map(p=>`\`${p.id}\` **${p.name}**`).join("\n")||"—";

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle("🎵 Playlists")
        .addFields(
          { name: `👤 Personales (${personal.length})`, value: fmt(personal), inline: false },
          { name: `🌐 Servidor (${servidor.length})`,   value: fmt(servidor),  inline: false },
        )
        .setDescription("Usa `/playlist ver id:[ID]` para ver las canciones.")
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── REPRODUCIR ──
    if (sub === "reproducir") {
      const plId    = interaction.options.getInteger("id");
      const mezclar = interaction.options.getBoolean("mezclar") || false;
      const vc      = interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({ content: `${EMOJI.CRUZ} Debes estar en un canal de voz.`, flags: 64 });
      await interaction.deferReply();

      const pl = await getPlaylist(plId);
      if (!pl) return interaction.editReply({ content: `${EMOJI.CRUZ} Playlist no encontrada.` });

      // Verificar acceso
      if (!pl.is_server && pl.owner_id !== interaction.user.id) {
        const { data: shared } = await supabase.from("playlist_shares")
          .select("id").eq("playlist_id", plId).eq("shared_with", interaction.user.id).maybeSingle();
        if (!shared) return interaction.editReply({ content: `${EMOJI.CRUZ} No tienes acceso a esta playlist.` });
      }

      let tracks = await getPlaylistTracks(plId);
      if (!tracks.length) return interaction.editReply({ content: `${EMOJI.CRUZ} La playlist está vacía.` });
      if (mezclar) tracks = tracks.sort(() => Math.random()-0.5);

      const musicaCmd = interaction.client.commands.get("musica");
      if (!musicaCmd) return interaction.editReply({ content: `${EMOJI.CRUZ} Sistema de música no disponible.` });

      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle(`▶️ ${pl.name}`)
        .setDescription(`Añadiendo **${tracks.length}** canciones${mezclar?" (aleatorio)":""}...`)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});

      let added = 0;
      for (const track of tracks) {
        try {
          const fake = {
            guildId: interaction.guildId, guild: interaction.guild,
            user: interaction.user, member: interaction.member,
            channel: interaction.channel, client: interaction.client,
            options: { getSubcommand: ()=>"play", getString: n=>n==="busqueda"?track.title:null },
            deferReply: async()=>{}, editReply: async()=>{}, reply: async()=>{},
            replied: false, deferred: true,
          };
          await musicaCmd.execute(fake);
          added++;
          await new Promise(r=>setTimeout(r,400));
        } catch {}
      }

      return interaction.followUp({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle("✅ Playlist en cola")
        .setDescription(`**${added}** canciones añadidas de **${pl.name}**`)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── ELIMINAR PLAYLIST ──
    if (sub === "eliminar") {
      const plId = interaction.options.getInteger("id");
      const pl   = await getPlaylist(plId);
      if (!pl) return interaction.reply({ content: `${EMOJI.CRUZ} Playlist no encontrada.`, flags: 64 });
      if (pl.owner_id !== interaction.user.id)
        return interaction.reply({ content: `${EMOJI.CRUZ} Solo el creador puede eliminarla.`, flags: 64 });

      await supabase.from("playlists").delete().eq("id", plId);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#ef4444").setTitle("🗑️ Playlist eliminada")
        .setDescription(`**${pl.name}** eliminada con todas sus canciones.`)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }

    // ── COMPARTIR ──
    if (sub === "compartir") {
      const plId   = interaction.options.getInteger("id");
      const target = interaction.options.getUser("usuario");
      const pl     = await getPlaylist(plId);
      if (!pl) return interaction.reply({ content: `${EMOJI.CRUZ} Playlist no encontrada.`, flags: 64 });
      if (pl.owner_id !== interaction.user.id)
        return interaction.reply({ content: `${EMOJI.CRUZ} Solo el creador puede compartirla.`, flags: 64 });
      if (target.id === interaction.user.id)
        return interaction.reply({ content: `${EMOJI.CRUZ} No puedes compartirte la playlist a ti mismo.`, flags: 64 });

      const { error } = await supabase.from("playlist_shares").upsert({
        playlist_id: plId, shared_with: target.id,
        shared_by: interaction.user.id, shared_at: new Date().toISOString(),
      }, { onConflict: "playlist_id,shared_with" });

      if (error) return interaction.reply({ content: `${EMOJI.CRUZ} Error: ${error.message}`, flags: 64 });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor("#1DB954").setTitle("✅ Playlist compartida")
        .setDescription(`<@${target.id}> ahora puede reproducir **${pl.name}** con \`/playlist reproducir id:${plId}\``)
        .setFooter({ text: "NexaBot Music Pro" })
      ]});
    }
  },
};
