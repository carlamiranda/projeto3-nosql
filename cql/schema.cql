-- =====================================================================
-- Estrutura do banco do Mini Discord (Apache Cassandra)
-- O servidor já cria tudo isto sozinho ao iniciar.
-- Este arquivo serve para mostrar o modelo e para criar na mão, se quiser:
--   docker exec -i cassandra-chat cqlsh < cql/schema.cql
-- =====================================================================

-- Keyspace = "banco de dados". Define como os dados são copiados.
-- replication_factor = 1 porque a demo tem um nó só (em produção seria 3).
CREATE KEYSPACE IF NOT EXISTS chat
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE chat;

-- Canais do servidor (tabela pequena)
CREATE TABLE IF NOT EXISTS canais (
  id        text PRIMARY KEY,
  nome      text,
  descricao text
);

-- Mensagens, pensadas para a consulta principal do chat:
-- "mensagens do canal X, das mais novas para as mais antigas".
--   Chave de partição: (canal_id, bucket)  -> cada canal, em cada mês, é uma partição
--   Clustering:        mensagem_id DESC    -> já vem ordenado, mais nova primeiro
--   reacoes:           coluna map          -> só é gravada nas mensagens que receberam reação
CREATE TABLE IF NOT EXISTS mensagens_por_canal (
  canal_id    text,
  bucket      int,        -- mês da mensagem no formato AAAAMM, ex.: 202611
  mensagem_id timeuuid,   -- id que também guarda a data e a hora
  autor       text,
  texto       text,
  editada     boolean,
  reacoes     map<text, int>,
  PRIMARY KEY ((canal_id, bucket), mensagem_id)
) WITH CLUSTERING ORDER BY (mensagem_id DESC);

INSERT INTO canais (id, nome, descricao) VALUES ('geral', 'geral', 'Conversa geral da turma');
INSERT INTO canais (id, nome, descricao) VALUES ('nosql', 'nosql', 'Projeto 3 de Bancos de Dados NoSQL');
INSERT INTO canais (id, nome, descricao) VALUES ('cassandra', 'cassandra', 'Dúvidas sobre o Apache Cassandra');
