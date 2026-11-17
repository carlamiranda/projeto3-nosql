-- =====================================================================
-- PLANO B da demo: o CRUD direto no terminal do Cassandra (cqlsh)
-- Abra o terminal do banco com:
--   docker exec -it cassandra-chat cqlsh
-- e cole os comandos um de cada vez.
--
-- ATENÇÃO: troque 202611 pelo mês da apresentação no formato AAAAMM
-- (ex.: dezembro de 2026 = 202612). Assim as mensagens aparecem no chat também.
-- =====================================================================

USE chat;

-- ---------- C: CREATE (inserção) ----------
INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e409b4-e282-11f1-87c4-25f2224dcd43, 'ana', 'Oi pessoal, bora apresentar?', false);

INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e5a166-e282-11f1-87c4-25f2224dcd43, 'bruno', 'Bora! O Cassandra ja subiu', false);

INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e7388c-e282-11f1-87c4-25f2224dcd43, 'carla', 'Mensagem errada, vou apagar', false);

-- Mensagem temporária: some sozinha depois de 60 segundos (TTL)
INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e8cb8e-e282-11f1-87c4-25f2224dcd43, 'bot', 'Esta mensagem se autodestroi', false)
USING TTL 60;

-- ---------- R: READ (leitura) ----------
-- Mensagens do canal, da mais nova para a mais antiga, com a hora tirada do id
SELECT autor, texto, editada, reacoes, toTimestamp(mensagem_id) AS enviada_em, TTL(texto) AS segundos_restantes
FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611;

-- ---------- U: UPDATE 1 (atualização): editar o texto ----------
UPDATE mensagens_por_canal
SET texto = 'Bora! O Cassandra 5.0 ja subiu no Docker', editada = true
WHERE canal_id = 'nosql' AND bucket = 202611
  AND mensagem_id = 78e5a166-e282-11f1-87c4-25f2224dcd43;

-- ---------- U: UPDATE 2 (alteração): adicionar uma reação na coluna map ----------
UPDATE mensagens_por_canal
SET reacoes = reacoes + {'curtir': 3}
WHERE canal_id = 'nosql' AND bucket = 202611
  AND mensagem_id = 78e409b4-e282-11f1-87c4-25f2224dcd43;

-- ---------- D: DELETE (exclusão) ----------
DELETE FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611
  AND mensagem_id = 78e7388c-e282-11f1-87c4-25f2224dcd43;

-- Rode o SELECT da leitura de novo depois de cada passo para a turma ver a mudança.

-- ---------- Bônus: mostrar a regra da modelagem ----------
-- Sem a chave de partição, o Cassandra recusa a consulta (de propósito):
-- SELECT * FROM mensagens_por_canal WHERE autor = 'ana';
-- -> erro pedindo ALLOW FILTERING. Ele obriga a consultar pela partição.
