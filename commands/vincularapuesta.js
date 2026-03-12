const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vincularapuesta")
    .setDescription("Vincular apuesta con evento deportivo")
    .addStringOption(o => o.setName("bet_id").setDescription("ID apuesta").setRequired(true))
    .addStringOption(o => o.setName("sports_id").setDescription("ID evento deportivo").setRequired(true)),

  async execute(interaction) {
    const supabase = interaction.client.supabase;
    const betId = interaction.options.getString("bet_id");
    const sportsId = interaction.options.getString("sports_id");

    const { error } = await supabase
      .from('sports_events')
      .update({ bet_event_id: betId })
      .eq('event_id', sportsId);

    if (error) {
      return interaction.reply({ content: "❌ Error vinculando", ephemeral: true });
    }

    interaction.reply(`✅ Apuesta \`${betId}\` vinculada a evento \`${sportsId}\``);
  }
};
