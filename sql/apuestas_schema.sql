-- ================================================================
-- SCHEMA: Sistema de Apuestas NexaBot
-- Ejecutar en Supabase SQL Editor
-- ================================================================

-- Tabla de partidos/eventos apostables
CREATE TABLE IF NOT EXISTS apuestas_partidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  deporte TEXT NOT NULL,
  competicion TEXT NOT NULL,
  partido TEXT NOT NULL,
  cuota_local DECIMAL(5,2) NOT NULL,
  cuota_empate DECIMAL(5,2) NOT NULL,
  cuota_visitante DECIMAL(5,2) NOT NULL,
  apuesta_min INTEGER DEFAULT 10,
  apuesta_max INTEGER DEFAULT 10000,
  close_time TIMESTAMP WITH TIME ZONE NOT NULL,
  winner TEXT,  -- 'local' | 'empate' | 'visitante'
  status TEXT DEFAULT 'open',  -- 'open' | 'closed' | 'cancelled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla de apuestas individuales de usuarios
CREATE TABLE IF NOT EXISTS apuestas_usuarios (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  match_id UUID REFERENCES apuestas_partidos(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selection TEXT NOT NULL,  -- 'local' | 'empate' | 'visitante'
  amount INTEGER NOT NULL,
  odds DECIMAL(5,2) NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'won' | 'lost' | 'error'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_apuestas_guild ON apuestas_partidos(guild_id);
CREATE INDEX IF NOT EXISTS idx_apuestas_status ON apuestas_partidos(status);
CREATE INDEX IF NOT EXISTS idx_usuarios_match ON apuestas_usuarios(match_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_user ON apuestas_usuarios(user_id);
