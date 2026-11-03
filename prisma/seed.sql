-- Demo merchant for local development. API key: pk_demo_pulso_merchant
-- (only its SHA-256 hash is stored).
INSERT INTO "merchants" ("id", "name", "api_key_hash")
VALUES ('6f1c2b7a-3d4e-4f5a-8b9c-0d1e2f3a4b5c', 'Tienda Demo CDMX', 'ac6d738065cf5b772bb81f7aef46561389a4a0af530912e784abbb10dea828fa')
ON CONFLICT ("id") DO NOTHING;
