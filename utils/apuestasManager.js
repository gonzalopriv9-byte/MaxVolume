const { supabase } = require('./db');

// Token API de UnbelievaBoat (añadir en .env como UB_API_TOKEN)
const UB_TOKEN = process.env.UB_API_TOKEN;
const UB_API = 'https://unbelievaboat.com/api/v1';

/**
 * Quita dinero del usuario en UnbelievaBoat
 * @param {string} guildId
 * @param {string} userId
 * @param {number} amount
 */
async function removeMoney(guildId, userId, amount) {
  if (!UB_TOKEN) {
    console.warn('[UnbelievaBoat] UB_API_TOKEN no configurado.');
    return false;
  }
  try {
    const res = await fetch(`${UB_API}/guilds/${guildId}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        Authorization: UB_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cash: -Math.abs(amount) })
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('[UnbelievaBoat] Error removeMoney:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[UnbelievaBoat] removeMoney exception:', e);
    return false;
  }
}

/**
 * Añade dinero al usuario en UnbelievaBoat
 * @param {string} guildId
 * @param {string} userId
 * @param {number} amount
 */
async function addMoney(guildId, userId, amount) {
  if (!UB_TOKEN) {
    console.warn('[UnbelievaBoat] UB_API_TOKEN no configurado.');
    return false;
  }
  try {
    const res = await fetch(`${UB_API}/guilds/${guildId}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        Authorization: UB_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ cash: Math.abs(amount) })
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('[UnbelievaBoat] Error addMoney:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[UnbelievaBoat] addMoney exception:', e);
    return false;
  }
}

/**
 * Procesa el pago a ganadores de una apuesta cerrada
 * @param {string} matchId
 * @param {string} resultado - 'local' | 'empate' | 'visitante'
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function pagarApuestasGanadoras(matchId, resultado, guildId, client) {
  const { data: bets } = await supabase
    .from('apuestas_usuarios')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'pending');

  if (!bets || bets.length === 0) return { ganadores: 0, perdedores: 0 };

  let ganadores = 0;
  let perdedores = 0;

  for (const bet of bets) {
    if (bet.selection === resultado) {
      const ganancia = Math.floor(bet.amount * bet.odds);
      const ok = await addMoney(guildId, bet.user_id, ganancia);
      await supabase.from('apuestas_usuarios').update({ status: ok ? 'won' : 'error' }).eq('id', bet.id);
      if (ok) {
        ganadores++;
        // Notificar al usuario por DM
        try {
          const user = await client.users.fetch(bet.user_id);
          await user.send(`🎉 ¡Ganaste tu apuesta! Cobras **${ganancia} monedas** (x${bet.odds}) en el servidor.`);
        } catch (_) {}
      }
    } else {
      await supabase.from('apuestas_usuarios').update({ status: 'lost' }).eq('id', bet.id);
      perdedores++;
    }
  }

  return { ganadores, perdedores };
}

module.exports = { removeMoney, addMoney, pagarApuestasGanadoras };
