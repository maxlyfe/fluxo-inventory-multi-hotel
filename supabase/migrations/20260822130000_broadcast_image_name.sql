-- Disparo em massa com imagem anexada.
--
-- Guarda só o nome do arquivo, não a imagem: o histórico precisa dizer que o
-- disparo levou anexo (e qual), e base64 de até 5 MB por linha inviabilizaria
-- a tabela. A imagem em si vive no WhatsApp do destinatário.

ALTER TABLE whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS image_name text;

COMMENT ON COLUMN whatsapp_broadcasts.image_name IS
  'Nome do arquivo de imagem anexado ao disparo, ou NULL quando foi só texto.';
