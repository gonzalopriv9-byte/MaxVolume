const { supabase } = require("./db");

// ==================== TIPOS DE PREMIUM ====================
const PREMIUM_TIERS = {
  FREE: "free",
  // PERSONAL (usuarios)
  PERSONAL: "personal",         // 1.99€/mes, 10€/año, 15€ vitalicio
  // POR SERVIDOR (admins)
  STARTER: "starter",           // 2.99€/mes
  PRO: "pro",                   // 5.99€/mes
  ELITE: "elite",               // 12.99€/mes
};

// ==================== LÍMITES POR TIER ====================
const TIER_LIMITS = {
  free: {
    maxActiveTickets: 50,
    maxCategories: 1,
    maxQuestions: 2,
    hasAdvancedLogs: false,
    hasLevels: false,
    hasGiveaways: false,
    hasEconomy: false,
    hasAI: false,
    hasBackup: true,        // backup básico existe
    hasAutoBackup: false,
    hasCustomWelcome: false,
    hasAutoRoles: false,
    hasPolls: false,
    maxAutoRoles: 0,
  },
  starter: {
    maxActiveTickets: 999,
    maxCategories: 3,
    maxQuestions: 5,
    hasAdvancedLogs: false,
    hasLevels: false,
    hasGiveaways: false,
    hasEconomy: false,
    hasAI: false,
    hasBackup: true,
    hasAutoBackup: true,
    hasCustomWelcome: true,
    hasAutoRoles: true,
    hasPolls: false,
    maxAutoRoles: 3,
  },
  pro: {
    maxActiveTickets: 999,
    maxCategories: 10,
    maxQuestions: 5,
    hasAdvancedLogs: true,
    hasLevels: true,
    hasGiveaways: true,
    hasEconomy: false,
    hasAI: false,
    hasBackup: true,
    hasAutoBackup: true,
    hasCustomWelcome: true,
    hasAutoRoles: true,
    hasPolls: true,
    maxAutoRoles: 10,
  },
  elite: {
    maxActiveTickets: 999,
    maxCategories: 25,
    maxQuestions: 5,
    hasAdvancedLogs: true,
    hasLevels: true,
    hasGiveaways: true,
    hasEconomy: true,
    hasAI: true,
    hasBackup: true,
    hasAutoBackup: true,
    hasCustomWelcome: true,
    hasAutoRoles: true,
    hasPolls: true,
    maxAutoRoles: 999,
  },
};

// ==================== OBTENER TIER DE UN SERVIDOR ====================
async function getGuildTier(guildId) {
  try {
    const { data } = await supabase
      .from("premium_subscriptions")
      .select("tier, expires_at, active")
      .eq("guild_id", guildId)
      .eq("active", true)
      .single();

    if (!data) return PREMIUM_TIERS.FREE;

    // Comprobar si expiró
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      await supabase
        .from("premium_subscriptions")
        .update({ active: false })
        .eq("guild_id", guildId);
      return PREMIUM_TIERS.FREE;
    }

    return data.tier || PREMIUM_TIERS.FREE;
  } catch {
    return PREMIUM_TIERS.FREE;
  }
}

// ==================== OBTENER TIER DE UN USUARIO ====================
async function getUserTier(userId) {
  try {
    const { data } = await supabase
      .from("premium_users")
      .select("tier, expires_at, active")
      .eq("user_id", userId)
      .eq("active", true)
      .single();

    if (!data) return PREMIUM_TIERS.FREE;

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      await supabase
        .from("premium_users")
        .update({ active: false })
        .eq("user_id", userId);
      return PREMIUM_TIERS.FREE;
    }

    return data.tier || PREMIUM_TIERS.FREE;
  } catch {
    return PREMIUM_TIERS.FREE;
  }
}

// ==================== OBTENER LÍMITES EFECTIVOS ====================
// Combina el tier del servidor + si el usuario tiene premium personal
async function getEffectiveLimits(guildId, userId = null) {
  const guildTier = await getGuildTier(guildId);
  const userTier = userId ? await getUserTier(userId) : PREMIUM_TIERS.FREE;

  // El tier del servidor es la base
  const base = { ...TIER_LIMITS[guildTier] || TIER_LIMITS.free };

  // Si el usuario tiene premium personal, desbloquea algunas cosas extra para él
  if (userTier === PREMIUM_TIERS.PERSONAL) {
    base.userHasPersonal = true;
    base.hasAI = true; // personal desbloquea IA para ese usuario
  }

  base.guildTier = guildTier;
  base.userTier = userTier;
  return base;
}

// ==================== CHECK RÁPIDOS ====================
async function guildHasFeature(guildId, feature) {
  const limits = await getEffectiveLimits(guildId);
  return !!limits[feature];
}

async function isGuildPremium(guildId) {
  const tier = await getGuildTier(guildId);
  return tier !== PREMIUM_TIERS.FREE;
}

async function isUserPremium(userId) {
  const tier = await getUserTier(userId);
  return tier !== PREMIUM_TIERS.FREE;
}

// ==================== ACTIVAR PREMIUM ====================
async function activateGuildPremium(guildId, tier, months = 1, activatedBy = null) {
  let expiresAt = null;

  // lifetime = null (no expira)
  if (months !== -1) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    expiresAt = d.toISOString();
  }

  const { error } = await supabase
    .from("premium_subscriptions")
    .upsert({
      guild_id: guildId,
      tier,
      active: true,
      expires_at: expiresAt,
      activated_by: activatedBy,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  return !error;
}

async function activateUserPremium(userId, tier, months = 1, activatedBy = null) {
  let expiresAt = null;
  if (months !== -1) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    expiresAt = d.toISOString();
  }

  const { error } = await supabase
    .from("premium_users")
    .upsert({
      user_id: userId,
      tier,
      active: true,
      expires_at: expiresAt,
      activated_by: activatedBy,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  return !error;
}

// ==================== REVOCAR PREMIUM ====================
async function revokeGuildPremium(guildId) {
  const { error } = await supabase
    .from("premium_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("guild_id", guildId);
  return !error;
}

async function revokeUserPremium(userId) {
  const { error } = await supabase
    .from("premium_users")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return !error;
}

// ==================== RESPUESTA DE PAYWALL ====================
function premiumRequired(tier = "starter") {
  const emojis = { starter: "🟢", pro: "🔵", elite: "🟣" };
  const prices = {
    starter: "2,99€/mes",
    pro: "5,99€/mes",
    elite: "12,99€/mes",
    personal: "1,99€/mes",
  };
  return {
    content: `${emojis[tier] || "💎"} **Esta función requiere NEXA ${tier.toUpperCase()}** (${prices[tier] || "Premium"})\n\nActívalo en: **nexabot.com/premium** o escribe \`/premium info\``,
    flags: 64,
  };
}

module.exports = {
  PREMIUM_TIERS,
  TIER_LIMITS,
  getGuildTier,
  getUserTier,
  getEffectiveLimits,
  guildHasFeature,
  isGuildPremium,
  isUserPremium,
  activateGuildPremium,
  activateUserPremium,
  revokeGuildPremium,
  revokeUserPremium,
  premiumRequired,
};
