// En el execute del comando resolverapuesta
const { data: event } = await supabase
  .from("bet_events")
  .select("*")
  .eq("id", eventId)
  .single();

if (!event || event.status !== "open") {
  return interaction.reply({ content: EMOJI.CRUZ + " Evento no encontrado o ya resuelto.", flags: 64 });
}

// Array dinámico de opciones (solo las que existen y no son null)
const opciones = [];
for (let i = 1; i <= 4; i++) {
  const opcion = event[`opcion${i}`];
  if (opcion) {
    opciones.push({
      label: `Opción ${i}: ${opcion.substring(0, 100)}`,  // Max 100 chars para label
      value: i.toString(),
      description: `Apuesta por opción ${i}`
    });
  }
}

if (opciones.length === 0) {
  return interaction.reply({ content: EMOJI.CRUZ + " No hay opciones válidas en este evento.", flags: 64 });
}

const selectMenu = new StringSelectMenuBuilder()
  .setCustomId(`resolve_event_${event.id}`)
  .setPlaceholder("Elige la opción ganadora")
  .addOptions(opciones.slice(0, 25));  // Max 25 opciones en Discord

const row = new ActionRowBuilder().addComponents(selectMenu);

await interaction.reply({
  content: `**${event.titulo}** — Elige la opción ganadora:`,
  components: [row]
});
