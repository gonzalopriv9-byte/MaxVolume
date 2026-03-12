const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const EMOJI = {
  CRUZ:        "<a:CruzRoja:1480947488960806943>",
  CHECK:       "<a:Tick:1480638398816456848>",
  ADVERTENCIA: "<a:ADVERTENCIA:1477616948937490452>",
  NEXALOGO:    "<a:NEXALOGO:1477286399345561682>",
  LOADING:     "<a:Loading:1481763726972555324>",
};

const OPCION_COLORES = [ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Primary, ButtonStyle.Secondary];
const OPCION_EMOJIS  = ["🟢", "🔴", "🔵", "⚫"];

const titulosPendientes = new Map();

function buildBar(pct) {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

async function buildEventEmbed(supabase, evento) {
  const { data: bets } = await supabase
    .from("bets").select("option, amount").eq("event_id", evento.id);

  let totalPozo = 0;
  const totales = {};
  for (let i = 1; i <= 4; i++) {
    if (!evento[`opcion${i}`]) continue;
    const suma = (bets || []).filter(b => b.option === i).reduce((a, b) => a + b.amount, 0);
    totales[i] = suma;
    totalPozo += suma;
  }

  const numApostadores = (bets || []).length;
  const statusLabel = evento.status === "open" ? "🟢 ABIERTA" : evento.status === "closed" ? "🔒 CERRADA" : "✅ RESUELTA";

  const embed = new EmbedBuilder()
    .setColor(evento.status === "open" ? "#00BFFF" : evento.status === "closed" ? "#FF8C00" : "#00FF88")
    .setTitle(`${EMOJI.NEXALOGO} ${evento.titulo}`)
    .setDescription(
      `> **Estado:** ${statusLabel}\n` +
      `> **💰 Pozo total:** \`${totalPozo.toLocaleString()}\` 💵\n` +
      `> **👥 Apostadores:** \`${numApostadores}\`\n\n` +
      `Pulsa un botón para apostar. Las ganancias se reparten entre los ganadores.`
    )
    .setFooter({ text: `NexaBot Apuestas • ID: ${evento.id} • 5% comisión de casa` })
    .setTimestamp();

  for (let i = 1; i <= 4; i++) {
    if (!evento[`opcion${i}`]) continue;
    const suma = totales[i] || 0;
    const pct  = totalPozo > 0 ? Math.round((suma / totalPozo) * 100) : 0;
    const barra = buildBar(pct);
    embed.addFields({
      name: `${OPCION_EMOJIS[i - 1]} Opción ${i}: ${evento[`opcion${i}`]}`,
      value: `${barra} **${pct}%**  |  \`${suma.toLocaleString()}\` apostado`,
      inline: false,
    });
  }
  return embed;
}

function buildBetButtons(evento, disabled = false) {
  const btns = [];
  for (let i = 1; i <= 4; i++) {
    if (!evento[`opcion${i}`]) continue;
    btns.push(
      new ButtonBuilder()
        .setCustomId(`bet_event_${evento.id}_${i}`)
        .setLabel(`${OPCION_EMOJIS[i - 1]} ${evento[`opcion${i}`]}`)
        .setStyle(OPCION_COLORES[i - 1])
        .setDisabled(disabled)
    );
  }
  const rows = [];
  for (let i = 0; i < btns.length; i += 4)
    rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 4)));
  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("apostar")
    .setDescription("Crear un evento de apuestas")
    .addStringOption(opt =>
      opt.setName("titulo").setDescription("Título del evento, ej: MADRID vs CITY").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("opciones").setDescription("Número de opciones").setRequired(true)
        .addChoices(
          { name: "2 opciones",        value: 2 },
          { name: "3 opciones (Elite)", value: 3 },
          { name: "4 opciones (Elite)", value: 4 },
        )
    )
    .addIntegerOption(opt =>
      opt.setName("minimo").setDescription("Apuesta mínima (opcional, por defecto 1)").setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName("maximo").setDescription("Apuesta máxima por usuario (opcional)").setRequired(false)
    ),

  titulosPendientes,
  buildEventEmbed,
  buildBetButtons,

  async execute(interaction) {
    const supabase    = interaction.client.supabase;
    const titulo      = interaction.options.getString("titulo");
    const numOpciones = interaction.options.getInteger("opciones");
    const minApuesta  = interaction.options.getInteger("minimo") || 1;
    const maxApuesta  = interaction.options.getInteger("maximo") || null;

    if (!supabase)
      return interaction.reply({ content: `${EMOJI.CRUZ} Supabase no disponible.`, ephemeral: true });

    if (numOpciones > 2) {
      const { data: sub } = await supabase.from("premium_subscriptions")
        .select("active, expires_at").eq("guild_id", interaction.guild.id).eq("active", true).maybeSingle();
      const valida = sub && (sub.expires_at === null || new Date(sub.expires_at) > new Date());
      if (!valida)
        return interaction.reply({
          content: `${EMOJI.ADVERTENCIA} **Necesitas Elite** para más de 2 opciones. Usa \`/premium\`.`,
          ephemeral: true,
        });
    }

    titulosPendientes.set(interaction.user.id, { titulo, numOpciones, minApuesta, maxApuesta });
    setTimeout(() => titulosPendientes.delete(interaction.user.id), 10 * 60 * 1000);

    const modal = new ModalBuilder()
      .setCustomId(`apostar_opciones_${numOpciones}`)
      .setTitle("Opciones del evento");

    for (let i = 1; i <= numOpciones; i++) {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`opcion${i}`)
            .setLabel(`Opción ${i}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(i === 1 ? "Ej: Real Madrid" : i === 2 ? "Ej: Man City" : `Opción ${i}`)
            .setMaxLength(50)
            .setRequired(true)
        )
      );
    }
    await interaction.showModal(modal);
  },
};
