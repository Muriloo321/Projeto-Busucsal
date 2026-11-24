-- ============================================================================
-- BusUCSAL — Estrutura definitiva do banco (PostgreSQL 16 + PostGIS 3)
-- As sete tabelas da Seção 3 do Planejamento Técnico.
-- Dados demonstrativos ficam em database/seed-demo.sql (arquivo separado).
-- Coordenadas em SRID 4326 (WGS 84). Distâncias em metros calculadas via ::geography.
-- ============================================================================

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- 7. usuario_admin — equipe do BusUCSAL (senha armazenada como hash bcrypt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario_admin (
  id               SERIAL PRIMARY KEY,
  nome             VARCHAR(120) NOT NULL CHECK (char_length(btrim(nome)) >= 2),
  email            VARCHAR(160) NOT NULL UNIQUE
                     CHECK (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  senha_hash       VARCHAR(100) NOT NULL CHECK (senha_hash ~ '^\$2[aby]\$\d{2}\$.{53}$'),
  ativo            BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultimo_login_em  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 4. rota — trajeto (polilinha) e janela de operação. Uma linha por janela.
--    sentido: 'ida' / 'volta'. turno: 'M' (matutino), 'N' (noturno) ou 'M/N'.
--    Rotas e horários não são editáveis pelo painel (fora do escopo).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rota (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(120) NOT NULL,
  sentido         VARCHAR(10)  NOT NULL CHECK (sentido IN ('ida', 'volta')),
  trajeto         GEOMETRY(LineString, 4326) NOT NULL
                    CHECK (ST_IsValid(trajeto) AND ST_NPoints(trajeto) >= 2),
  horario_inicio  TIME         NOT NULL,
  horario_fim     TIME         NOT NULL,
  turno           VARCHAR(3)   NOT NULL CHECK (turno IN ('M', 'N', 'M/N')),
  ativa           BOOLEAN      NOT NULL DEFAULT TRUE,
  demonstrativa   BOOLEAN      NOT NULL DEFAULT FALSE,
  criado_em       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT rota_janela_valida CHECK (horario_fim > horario_inicio)
);
CREATE INDEX IF NOT EXISTS rota_trajeto_gix ON rota USING GIST (trajeto);

-- ---------------------------------------------------------------------------
-- 3. ponto_embarque — pontos oficiais (Seção 6). geom é derivada de lat/long.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ponto_embarque (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(120) NOT NULL CHECK (char_length(btrim(nome)) >= 2),
  referencia      VARCHAR(200),
  latitude        DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude       DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  geom            GEOMETRY(Point, 4326)
                    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,
  ordem_na_rota   SMALLINT     NOT NULL CHECK (ordem_na_rota BETWEEN 1 AND 99),
  sentido         VARCHAR(10)  NOT NULL CHECK (sentido IN ('ida', 'volta')),
  turnos          VARCHAR(3)   NOT NULL DEFAULT 'M/N' CHECK (turnos IN ('M', 'N', 'M/N')),
  ativo           BOOLEAN      NOT NULL DEFAULT TRUE,
  demonstrativo   BOOLEAN      NOT NULL DEFAULT FALSE,
  criado_em       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ponto_ordem_ativa_uk ON ponto_embarque (sentido, ordem_na_rota) WHERE ativo;
CREATE INDEX IF NOT EXISTS ponto_embarque_geom_gix ON ponto_embarque USING GIST (geom);

-- ---------------------------------------------------------------------------
-- 1. posicao_veiculo — histórico de posições recebidas do rastreador (a cada 30 s).
--    rota_id/progresso_m: rota escolhida e distância percorrida ao longo dela (PostGIS).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posicao_veiculo (
  id                BIGSERIAL PRIMARY KEY,
  dispositivo_id    VARCHAR(64)  NOT NULL,
  latitude          DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude         DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  geom              GEOMETRY(Point, 4326)
                      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,
  velocidade_kmh    NUMERIC(6,2) CHECK (velocidade_kmh BETWEEN 0 AND 200),
  precisao_m        NUMERIC(8,2) CHECK (precisao_m >= 0),
  registrado_em     TIMESTAMPTZ  NOT NULL,
  recebido_em       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  fonte             VARCHAR(20)  NOT NULL DEFAULT 'rastreador'
                      CHECK (fonte IN ('rastreador', 'simulador', 'simulador_acelerado', 'cenario_demo')),
  rota_id           INTEGER REFERENCES rota (id) ON DELETE SET NULL,
  progresso_m       DOUBLE PRECISION CHECK (progresso_m >= 0),
  distancia_rota_m  DOUBLE PRECISION CHECK (distancia_rota_m >= 0),
  CONSTRAINT posicao_unica_por_instante UNIQUE (dispositivo_id, registrado_em)
);
CREATE INDEX IF NOT EXISTS posicao_dispositivo_tempo_idx ON posicao_veiculo (dispositivo_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS posicao_geom_gix ON posicao_veiculo USING GIST (geom);

-- ---------------------------------------------------------------------------
-- 2. estado_veiculo — estado consolidado (um registro por dispositivo rastreador).
--    status é recalculado pelo backend a partir dos dados (Seção 4.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estado_veiculo (
  dispositivo_id       VARCHAR(64) PRIMARY KEY,
  ultima_posicao_id    BIGINT REFERENCES posicao_veiculo (id) ON DELETE SET NULL,
  ultima_posicao       GEOMETRY(Point, 4326),
  ultima_atualizacao   TIMESTAMPTZ,
  velocidade_kmh       NUMERIC(6,2) CHECK (velocidade_kmh BETWEEN 0 AND 200),
  rota_id              INTEGER REFERENCES rota (id) ON DELETE SET NULL,
  progresso_m          DOUBLE PRECISION CHECK (progresso_m >= 0),
  distancia_rota_m     DOUBLE PRECISION CHECK (distancia_rota_m >= 0),
  parado_desde         TIMESTAMPTZ,
  status               VARCHAR(20) NOT NULL DEFAULT 'sem_dados'
                         CHECK (status IN ('em_circulacao', 'parado', 'sem_dados', 'fora_de_operacao')),
  status_calculado_em  TIMESTAMPTZ,
  proximo_ponto_id     INTEGER REFERENCES ponto_embarque (id) ON DELETE SET NULL,
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. aviso — avisos operacionais cadastrados pela equipe (RF09).
--    Vigente quando ativo e now() ∈ [inicio, fim). interrompe_operacao → "Fora de operação".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aviso (
  id                   SERIAL PRIMARY KEY,
  texto                VARCHAR(500) NOT NULL CHECK (char_length(btrim(texto)) >= 3),
  inicio               TIMESTAMPTZ  NOT NULL,
  fim                  TIMESTAMPTZ  NOT NULL,
  ativo                BOOLEAN      NOT NULL DEFAULT TRUE,
  interrompe_operacao  BOOLEAN      NOT NULL DEFAULT FALSE,
  demonstrativo        BOOLEAN      NOT NULL DEFAULT FALSE,
  criado_por           INTEGER REFERENCES usuario_admin (id) ON DELETE SET NULL,
  criado_em            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT aviso_periodo_valido CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS aviso_vigencia_idx ON aviso (ativo, inicio, fim);

-- ---------------------------------------------------------------------------
-- 6. sessao_conversa — contexto do diálogo por usuário (identificador pseudonimizado).
--    Expira 24 h após a criação e é excluída (LGPD).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessao_conversa (
  usuario_hash      CHAR(64)    PRIMARY KEY CHECK (usuario_hash ~ '^[0-9a-f]{64}$'),
  canal             VARCHAR(20) NOT NULL DEFAULT 'simulador' CHECK (canal IN ('simulador', 'whatsapp', 'telegram')),
  etapa_do_dialogo  VARCHAR(30) NOT NULL DEFAULT 'inicio'
                      CHECK (etapa_do_dialogo IN ('inicio', 'aguardando_ponto', 'menu_principal', 'ponto_definido')),
  ponto_id          INTEGER REFERENCES ponto_embarque (id) ON DELETE SET NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em         TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessao_expiracao_valida CHECK (expira_em > criado_em)
);
CREATE INDEX IF NOT EXISTS sessao_expira_idx ON sessao_conversa (expira_em);

COMMIT;
