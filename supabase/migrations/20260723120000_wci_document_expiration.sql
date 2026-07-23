-- Validade do documento (estrangeiros) capturada no web check-in.
-- A Erbon recebe via documents[].expirationDate; aqui fica a cópia no LyFe.
ALTER TABLE wci_checkin_guests
  ADD COLUMN IF NOT EXISTS document_expiration date;
