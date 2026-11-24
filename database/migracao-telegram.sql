-- Permite o canal 'telegram' nas sessões de conversa (para bancos criados antes da integração).
-- Seguro para repetir: remove qualquer CHECK que cite "canal" e recria com os três canais.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'sessao_conversa'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%canal%'
  LOOP
    EXECUTE format('ALTER TABLE sessao_conversa DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE sessao_conversa ADD CONSTRAINT sessao_conversa_canal_check CHECK (canal IN ('simulador', 'whatsapp', 'telegram'));
