-- =====================================================================
-- PLANO B da demo: o CRUD direto no terminal do Cassandra (cqlsh)
--
-- Abra o terminal do banco (com o "docker compose up" rodando) com:
--   docker exec -it cassandra-chat cqlsh
-- e cole os comandos UM BLOCO DE CADA VEZ, explicando cada passo.
--
-- As 4 operações pedidas no enunciado:
--   inserção (INSERT) · atualização (UPDATE) · alteração (ALTER TABLE) · exclusão (DELETE)
-- O SELECT depois de cada passo mostra o resultado.
--
-- Para rodar tudo de uma vez (ensaio):
--   docker exec -i cassandra-chat cqlsh < cql/demo-crud.cql
-- Para ensaiar de novo, desfaça a alteração antes:
--   docker exec cassandra-chat cqlsh -e "ALTER TABLE chat.mensagens_por_canal DROP fixada"
--
-- ATENÇÃO: 202611 = novembro de 2026 (bucket no formato AAAAMM).
-- Se a apresentação for em outro mês, troque 202611 pelo mês do dia
-- (ex.: dezembro de 2026 = 202612). Assim as mensagens aparecem no chat também.
-- Testado em 17/11/2026 com cassandra:5.0 no Docker.
-- =====================================================================

-- ---------- PARTE 0: estrutura (rode ANTES de entrar na sala) ----------
-- Se o chat já ligou uma vez, isto já existe e os comandos não fazem nada.
-- RF = 1 porque é um nó só no Docker; em produção seria 3.
CREATE KEYSPACE IF NOT EXISTS chat
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
USE chat;
CREATE TABLE IF NOT EXISTS mensagens_por_canal (
  canal_id text, bucket int, mensagem_id timeuuid,
  autor text, texto text, editada boolean, reacoes map<text, int>,
  PRIMARY KEY ((canal_id, bucket), mensagem_id)
) WITH CLUSTERING ORDER BY (mensagem_id DESC);

-- ---------- PARTE 1: CREATE (inserção) ----------
INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e409b4-e282-11f1-87c4-25f2224dcd43, 'ana', 'Oi pessoal, bora apresentar?', false);

INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e5a166-e282-11f1-87c4-25f2224dcd43, 'gabriel', 'oi', false);

INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, 78e7388c-e282-11f1-87c4-25f2224dcd43, 'carla', 'Mensagem errada, vou apagar', false);

-- Mensagem temporária: o próprio banco apaga depois de 60 segundos (TTL)
INSERT INTO mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada)
VALUES ('nosql', 202611, now(), 'bot', 'Aviso: esta mensagem some em 60 s', false)
USING TTL 60;

-- ---------- PARTE 2: READ (leitura) ----------
-- Lê UMA partição só, já ordenada da mais nova para a mais antiga (sem ORDER BY).
-- A hora sai do próprio id (timeuuid) e TTL() mostra quanto falta para sumir.
SELECT autor, texto, editada, reacoes,
       toTimestamp(mensagem_id) AS enviada_em, TTL(texto) AS segundos_restantes
FROM mensagens_por_canal WHERE canal_id = 'nosql' AND bucket = 202611;

-- ---------- PARTE 3: UPDATE (atualização): editar o texto ----------
UPDATE mensagens_por_canal SET texto = 'oi, tudo bem?', editada = true
WHERE canal_id = 'nosql' AND bucket = 202611
  AND mensagem_id = 78e5a166-e282-11f1-87c4-25f2224dcd43;

-- ---------- PARTE 4: ALTERAÇÃO (ALTER TABLE): muda a estrutura da tabela ----------
-- A tabela ganha a coluna "fixada" na hora. Nenhuma mensagem é reescrita:
-- as que já existem ficam com a coluna vazia (null).
-- (Se der "Column with name 'fixada' already exists", sobrou de um ensaio:
--  rode  ALTER TABLE mensagens_por_canal DROP fixada;  e repita.)
ALTER TABLE mensagens_por_canal ADD fixada boolean;

-- A coluna "fixada" aparece em todas as mensagens, vazia (null):
SELECT autor, texto, editada, fixada FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611;

-- ---------- PARTE 5: DELETE (exclusão) ----------
-- Por baixo, o DELETE grava um tombstone; o dado some de vez na compactação.
DELETE FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611
  AND mensagem_id = 78e7388c-e282-11f1-87c4-25f2224dcd43;

SELECT autor, texto, editada, fixada FROM mensagens_por_canal
WHERE canal_id = 'nosql' AND bucket = 202611;

-- ---------- EXTRA: mostrar uma desvantagem ao vivo ----------
-- Sem a chave de partição, o Cassandra recusa (pediria ALLOW FILTERING),
-- porque teria de varrer o cluster inteiro. É o "modelar pelas consultas".
-- (Comentado para o ensaio com "< cql/demo-crud.cql" não parar no erro.)
-- SELECT * FROM mensagens_por_canal WHERE autor = 'ana';
