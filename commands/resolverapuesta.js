const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

const EMOJI = { CRUZ: "<a:CruzRoja:1480947488960806943>", NEXALOGO: "<a:NEXALOGO:1477286399345561682>" };

console.log("✅ resolverapuesta CARGADO");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resolverapuesta")
    .setDescription("Resolver apuesta")
    .addStringOption(option => option.setName("id").setDescription("ID").setRequired(true)),
  async execute(interaction) {
    const supabase = interaction.client.supabase;
    const eventId = interaction.options.getString("id");
    await interaction.deferReply({ ephemeral: true });
    
    const { data: event } = await supabase.from("bet_events").select("*").eq("id", eventId).single();
    if (!event || event.status !== "open") return interaction.editReply({ content: `${EMOJI.CRUZ} Evento inválido.` });
    
    const opciones = [];
    for (let i = 1; i <= 4; i++) {
      if (event[`opcion${i}`]) opciones.push({ label: `Op ${i}`, value: i.toString() });
    }
    
    const select = new StringSelectMenuBuilder().setCustomId(`resolve_event_${eventId}`).addOptions(opciones);
    const row = new ActionRowBuilder().addComponents(select);
    
    await interaction.editReply({ content: "Elige ganador:", components: [row] });
  }
};
