// =====================================================================
// Mini Discord com Apache Cassandra (wide column store)
// Projeto 3 - Bancos de Dados NoSQL
//
// O servidor faz três coisas:
//   1. Conecta no Cassandra e cria o keyspace e as tabelas (se não existirem).
//   2. Entrega a página do chat (pasta "public").
//   3. Recebe as ações do chat pelo Socket.IO (tempo real) e executa o CRUD
//      no Cassandra: INSERT, SELECT, UPDATE e DELETE.
// =====================================================================

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cassandra = require('cassandra-driver');

const { TimeUuid } = cassandra.types;

// ---------------------------------------------------------------------
// Configurações (podem ser trocadas por variáveis de ambiente)
// ---------------------------------------------------------------------
const PORTA = Number(process.env.PORT || 3000);
const CASSANDRA_HOST = process.env.CASSANDRA_HOST || '127.0.0.1';
const CASSANDRA_PORTA = Number(process.env.CASSANDRA_PORT || 9042);
const CASSANDRA_DC = process.env.CASSANDRA_DC || 'datacenter1';
const KEYSPACE = 'chat';

const TTL_TEMPORARIA = 60;        // segundos que uma mensagem temporária dura
const LIMITE_HISTORICO = 50;      // quantas mensagens carregar ao abrir um canal
const TAMANHO_MAX_TEXTO = 2000;
const TAMANHO_MAX_NOME = 32;
const EMOJIS_PERMITIDOS = ['👍', '❤️', '😂', '🔥'];

// Canais que já vêm criados no banco
const CANAIS_INICIAIS = [
  { id: 'geral', nome: 'geral', descricao: 'Conversa geral da turma' },
  { id: 'nosql', nome: 'nosql', descricao: 'Projeto 3 de Bancos de Dados NoSQL' },
  { id: 'cassandra', nome: 'cassandra', descricao: 'Dúvidas sobre o Apache Cassandra' },
];

// ---------------------------------------------------------------------
// CQL: criação da estrutura (o mesmo que está em schema.cql)
// ---------------------------------------------------------------------
const CQL_CRIAR_KEYSPACE = `
  CREATE KEYSPACE IF NOT EXISTS ${KEYSPACE}
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`;

const CQL_CRIAR_TABELA_CANAIS = `
  CREATE TABLE IF NOT EXISTS ${KEYSPACE}.canais (
    id        text PRIMARY KEY,
    nome      text,
    descricao text
  )`;

const CQL_CRIAR_TABELA_MENSAGENS = `
  CREATE TABLE IF NOT EXISTS ${KEYSPACE}.mensagens_por_canal (
    canal_id    text,
    bucket      int,
    mensagem_id timeuuid,
    autor       text,
    texto       text,
    editada     boolean,
    reacoes     map<text, int>,
    PRIMARY KEY ((canal_id, bucket), mensagem_id)
  ) WITH CLUSTERING ORDER BY (mensagem_id DESC)`;

// ---------------------------------------------------------------------
// CQL: as operações do CRUD (usadas como prepared statements)
// ---------------------------------------------------------------------
const CQL = {
  inserirCanal:
    `INSERT INTO ${KEYSPACE}.canais (id, nome, descricao) VALUES (?, ?, ?)`,
  listarCanais:
    `SELECT id, nome, descricao FROM ${KEYSPACE}.canais`,

  // C - Create (inserção)
  inserirMensagem:
    `INSERT INTO ${KEYSPACE}.mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada) VALUES (?, ?, ?, ?, ?, false)`,
  inserirMensagemTemporaria:
    `INSERT INTO ${KEYSPACE}.mensagens_por_canal (canal_id, bucket, mensagem_id, autor, texto, editada) VALUES (?, ?, ?, ?, ?, false) USING TTL ${TTL_TEMPORARIA}`,

  // R - Read (leitura)
  lerMensagens:
    `SELECT mensagem_id, autor, texto, editada, reacoes, TTL(texto) AS segundos_restantes FROM ${KEYSPACE}.mensagens_por_canal WHERE canal_id = ? AND bucket = ? LIMIT ?`,
  lerUmaMensagem:
    `SELECT mensagem_id, autor, texto, editada, reacoes, TTL(texto) AS segundos_restantes FROM ${KEYSPACE}.mensagens_por_canal WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,

  // U - Update (atualização: editar o texto)
  editarMensagem:
    `UPDATE ${KEYSPACE}.mensagens_por_canal SET texto = ?, editada = true WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,
  editarMensagemComTtl:
    `UPDATE ${KEYSPACE}.mensagens_por_canal USING TTL ? SET texto = ?, editada = true WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,

  // U - Update (alteração: adicionar reação na coluna map)
  reagir:
    `UPDATE ${KEYSPACE}.mensagens_por_canal SET reacoes = reacoes + ? WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,
  reagirComTtl:
    `UPDATE ${KEYSPACE}.mensagens_por_canal USING TTL ? SET reacoes = reacoes + ? WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,

  // D - Delete (exclusão)
  apagarMensagem:
    `DELETE FROM ${KEYSPACE}.mensagens_por_canal WHERE canal_id = ? AND bucket = ? AND mensagem_id = ?`,
};

// ---------------------------------------------------------------------
// Funções de apoio
// ---------------------------------------------------------------------

// O "bucket" é o mês da mensagem no formato AAAAMM (ex.: 202611).
// Ele entra na chave de partição para nenhuma partição crescer sem limite.
function bucketDaData(data) {
  return data.getUTCFullYear() * 100 + (data.getUTCMonth() + 1);
}

function bucketAnterior(bucket) {
  const ano = Math.floor(bucket / 100);
  const mes = bucket % 100;
  return mes === 1 ? (ano - 1) * 100 + 12 : ano * 100 + (mes - 1);
}

// Monta o texto do comando CQL com os valores no lugar dos "?",
// só para mostrar no "Console do Cassandra" da página.
function cqlComValores(query, params) {
  let i = 0;
  return query.replace(/\?/g, () => formatarValorCql(params[i++]));
}

function formatarValorCql(valor) {
  if (valor === null || valor === undefined) return 'null';
  if (valor instanceof TimeUuid) return valor.toString();
  if (typeof valor === 'string') return `'${valor.replace(/'/g, "''")}'`;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (typeof valor === 'object') {
    const pares = Object.entries(valor).map(([k, v]) => `${formatarValorCql(k)}: ${formatarValorCql(v)}`);
    return `{${pares.join(', ')}}`;
  }
  return String(valor);
}

// Transforma uma linha do Cassandra no objeto que a página entende
function linhaParaMensagem(linha, canalId, bucket) {
  const id = linha.mensagem_id;
  return {
    canal: canalId,
    bucket,
    id: id.toString(),
    criadaEm: id.getDate().toISOString(),
    autor: linha.autor,
    texto: linha.texto,
    editada: Boolean(linha.editada),
    reacoes: linha.reacoes || {},
    ttl: linha.segundos_restantes === null || linha.segundos_restantes === undefined ? null : Number(linha.segundos_restantes),
  };
}

function textoValido(valor, max) {
  return typeof valor === 'string' && valor.trim().length > 0 && valor.length <= max;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Conexão com o Cassandra
// ---------------------------------------------------------------------
const client = new cassandra.Client({
  contactPoints: [CASSANDRA_HOST],
  protocolOptions: { port: CASSANDRA_PORTA },
  localDataCenter: CASSANDRA_DC,
});

const canais = new Map(); // id -> { id, nome, descricao }

// O Cassandra demora cerca de 1 minuto para ligar. Tentamos de novo até conseguir.
async function conectarComTentativas() {
  for (let tentativa = 1; tentativa <= 30; tentativa++) {
    try {
      await client.connect();
      console.log('✅ Conectado ao Cassandra em %s:%d', CASSANDRA_HOST, CASSANDRA_PORTA);
      return;
    } catch (erro) {
      console.log('⏳ Cassandra ainda não está pronto (tentativa %d/30): %s', tentativa, erro.message);
      await esperar(5000);
    }
  }
  throw new Error('Não foi possível conectar ao Cassandra. Ele está rodando?');
}

async function prepararBanco() {
  await client.execute(CQL_CRIAR_KEYSPACE);
  await client.execute(CQL_CRIAR_TABELA_CANAIS);
  await client.execute(CQL_CRIAR_TABELA_MENSAGENS);

  for (const canal of CANAIS_INICIAIS) {
    await client.execute(CQL.inserirCanal, [canal.id, canal.nome, canal.descricao], { prepare: true });
  }

  // A tabela de canais é bem pequena, então ler tudo dela não é problema.
  const resultado = await client.execute(CQL.listarCanais, [], { prepare: true });
  canais.clear();
  for (const linha of resultado.rows) {
    canais.set(linha.id, { id: linha.id, nome: linha.nome, descricao: linha.descricao });
  }
  console.log('✅ Keyspace "%s" pronto, com %d canais', KEYSPACE, canais.size);
}

// Mensagens de boas-vindas para nenhum canal começar vazio
const MENSAGENS_INICIAIS = {
  geral: [
    'Bem-vindos ao Mini Discord! 👋 Escolha um canal à esquerda e mande uma mensagem.',
    'Cada canal, em cada mês, é uma partição diferente no Cassandra. Veja a etiqueta "partição" no topo.',
  ],
  nosql: [
    'Canal do Projeto 3 de Bancos de Dados NoSQL. Paradigma: orientado a coluna (wide column store). Banco: Apache Cassandra.',
    'Aqui fazemos o CRUD ao vivo: enviar (INSERT), abrir o canal (SELECT), editar e reagir (UPDATE) e apagar (DELETE).',
  ],
  cassandra: [
    'Dica: olhe o Console do Cassandra à direita. Cada ação no chat vira um comando CQL.',
    'Marque ⏳ Temporária antes de enviar: a mensagem é gravada com TTL e o próprio Cassandra apaga depois de 60 segundos.',
  ],
};
const AUTOR_BOT = 'Bot do Cassandra';

// Se a partição do mês atual de um canal estiver vazia, grava as boas-vindas
async function preencherCanaisVazios() {
  const bucket = bucketDaData(new Date());
  for (const canalId of canais.keys()) {
    const textos = MENSAGENS_INICIAIS[canalId];
    if (!textos) continue;
    const existente = await client.execute(CQL.lerMensagens, [canalId, bucket, 1], { prepare: true });
    if (existente.rowLength > 0) continue;
    for (const texto of textos) {
      const mensagemId = TimeUuid.now();
      await client.execute(
        CQL.inserirMensagem,
        [canalId, bucketDaData(mensagemId.getDate()), mensagemId, AUTOR_BOT, texto],
        { prepare: true }
      );
      await esperar(5); // garante a ordem das mensagens
    }
  }
}

// Confere se quem pediu a ação é o autor da mensagem
function ehDoAutor(linha, dados) {
  return typeof dados.autor === 'string' && dados.autor.trim() === linha.autor;
}

// ---------------------------------------------------------------------
// Servidor web + tempo real
// ---------------------------------------------------------------------
const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/saude', (req, res) => {
  res.json({ ok: true, cassandra: client.getState().getConnectedHosts().length > 0 });
});

// Executa um comando no Cassandra e mostra o CQL no "Console do Cassandra" da página
async function executar(nomeOperacao, query, params) {
  const inicio = Date.now();
  const resultado = await client.execute(query, params, { prepare: true });
  io.emit('cql', {
    operacao: nomeOperacao,
    cql: cqlComValores(query, params),
    ms: Date.now() - inicio,
    hora: new Date().toISOString(),
  });
  return resultado;
}

// Busca uma mensagem pela chave primária completa (partição + clustering)
async function buscarMensagem(canalId, bucket, mensagemId) {
  const resultado = await executar('READ', CQL.lerUmaMensagem, [canalId, bucket, mensagemId]);
  return resultado.first();
}

function validarReferencia(dados) {
  if (!dados || !canais.has(dados.canal)) throw new Error('Canal inválido.');
  const bucket = Number(dados.bucket);
  if (!Number.isInteger(bucket) || bucket < 200001 || bucket > 999912) throw new Error('Bucket inválido.');
  let mensagemId;
  try {
    mensagemId = TimeUuid.fromString(String(dados.id));
  } catch (e) {
    throw new Error('Id de mensagem inválido.');
  }
  return { canalId: dados.canal, bucket, mensagemId };
}

// Lê a mensagem de novo no banco e avisa todo mundo que está no canal
async function avisarAtualizacao(canalId, bucket, mensagemId) {
  const atualizada = await buscarMensagem(canalId, bucket, mensagemId);
  if (atualizada) {
    io.to(canalId).emit('mensagem_atualizada', linhaParaMensagem(atualizada, canalId, bucket));
  } else {
    io.to(canalId).emit('mensagem_apagada', { canal: canalId, id: mensagemId.toString() });
  }
}

// Responde ao navegador sem derrubar o servidor quando algo dá errado
function tratar(socket, acao) {
  return async (dados, responder) => {
    const resposta = typeof responder === 'function' ? responder : () => {};
    try {
      const resultado = await acao(dados);
      resposta({ ok: true, ...(resultado || {}) });
    } catch (erro) {
      console.error('Erro:', erro.message);
      resposta({ ok: false, erro: erro.message });
    }
  };
}

io.on('connection', (socket) => {
  // Lista de canais para a barra lateral
  socket.emit('canais', Array.from(canais.values()));

  // R - Read: abrir um canal e carregar as mensagens
  socket.on('entrar_canal', tratar(socket, async (dados) => {
    const canalId = dados && dados.canal;
    if (!canais.has(canalId)) throw new Error('Canal inválido.');

    for (const sala of socket.rooms) {
      if (sala !== socket.id) socket.leave(sala);
    }
    socket.join(canalId);

    const bucketAtual = bucketDaData(new Date());
    const resultado = await executar('READ', CQL.lerMensagens, [canalId, bucketAtual, LIMITE_HISTORICO]);
    let mensagens = resultado.rows.map((l) => linhaParaMensagem(l, canalId, bucketAtual));

    // Se o mês está começando, completa com o mês anterior (outra partição)
    if (mensagens.length < LIMITE_HISTORICO) {
      const bucketAnt = bucketAnterior(bucketAtual);
      const anterior = await executar('READ', CQL.lerMensagens, [canalId, bucketAnt, LIMITE_HISTORICO - mensagens.length]);
      mensagens = mensagens.concat(anterior.rows.map((l) => linhaParaMensagem(l, canalId, bucketAnt)));
    }

    // O banco devolve da mais nova para a mais antiga; a tela mostra ao contrário
    mensagens.reverse();
    return { canal: canais.get(canalId), bucket: bucketAtual, mensagens };
  }));

  // C - Create: enviar mensagem
  socket.on('enviar', tratar(socket, async (dados) => {
    if (!dados || !canais.has(dados.canal)) throw new Error('Canal inválido.');
    if (!textoValido(dados.autor, TAMANHO_MAX_NOME)) throw new Error('Nome inválido.');
    if (!textoValido(dados.texto, TAMANHO_MAX_TEXTO)) throw new Error('Mensagem vazia ou longa demais.');

    const mensagemId = TimeUuid.now();
    const bucket = bucketDaData(mensagemId.getDate());
    const autor = dados.autor.trim();
    const texto = dados.texto.trim();
    const temporaria = Boolean(dados.temporaria);

    await executar(
      'CREATE',
      temporaria ? CQL.inserirMensagemTemporaria : CQL.inserirMensagem,
      [dados.canal, bucket, mensagemId, autor, texto]
    );

    const mensagem = {
      canal: dados.canal,
      bucket,
      id: mensagemId.toString(),
      criadaEm: mensagemId.getDate().toISOString(),
      autor,
      texto,
      editada: false,
      reacoes: {},
      ttl: temporaria ? TTL_TEMPORARIA : null,
    };
    io.to(dados.canal).emit('nova_mensagem', mensagem);
  }));

  // U - Update (atualização): editar o texto
  socket.on('editar', tratar(socket, async (dados) => {
    const { canalId, bucket, mensagemId } = validarReferencia(dados);
    if (!textoValido(dados.texto, TAMANHO_MAX_TEXTO)) throw new Error('Mensagem vazia ou longa demais.');

    // No Cassandra, UPDATE em uma linha que não existe cria a linha (upsert).
    // Por isso conferimos antes se a mensagem ainda existe.
    const atual = await buscarMensagem(canalId, bucket, mensagemId);
    if (!atual) throw new Error('Essa mensagem não existe mais.');
    if (!ehDoAutor(atual, dados)) throw new Error('Você só pode editar as suas próprias mensagens.');

    const texto = dados.texto.trim();
    if (atual.segundos_restantes) {
      // Mensagem temporária: mantém o tempo que falta para ela sumir
      await executar('UPDATE', CQL.editarMensagemComTtl, [atual.segundos_restantes, texto, canalId, bucket, mensagemId]);
    } else {
      await executar('UPDATE', CQL.editarMensagem, [texto, canalId, bucket, mensagemId]);
    }

    await avisarAtualizacao(canalId, bucket, mensagemId);
  }));

  // U - Update (alteração): adicionar uma reação na coluna map
  socket.on('reagir', tratar(socket, async (dados) => {
    const { canalId, bucket, mensagemId } = validarReferencia(dados);
    if (!EMOJIS_PERMITIDOS.includes(dados.emoji)) throw new Error('Reação inválida.');

    const atual = await buscarMensagem(canalId, bucket, mensagemId);
    if (!atual) throw new Error('Essa mensagem não existe mais.');

    const reacoes = atual.reacoes || {};
    const novaContagem = (reacoes[dados.emoji] || 0) + 1;
    const alteracao = { [dados.emoji]: novaContagem };

    if (atual.segundos_restantes) {
      await executar('UPDATE', CQL.reagirComTtl, [atual.segundos_restantes, alteracao, canalId, bucket, mensagemId]);
    } else {
      await executar('UPDATE', CQL.reagir, [alteracao, canalId, bucket, mensagemId]);
    }

    await avisarAtualizacao(canalId, bucket, mensagemId);
  }));

  // D - Delete: apagar mensagem
  socket.on('apagar', tratar(socket, async (dados) => {
    const { canalId, bucket, mensagemId } = validarReferencia(dados);
    const atual = await buscarMensagem(canalId, bucket, mensagemId);
    if (!atual) throw new Error('Essa mensagem não existe mais.');
    if (!ehDoAutor(atual, dados)) throw new Error('Você só pode apagar as suas próprias mensagens.');

    await executar('DELETE', CQL.apagarMensagem, [canalId, bucket, mensagemId]);
    io.to(canalId).emit('mensagem_apagada', { canal: canalId, id: mensagemId.toString() });
  }));
});

// ---------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------
async function iniciar() {
  await conectarComTentativas();
  await prepararBanco();
  await preencherCanaisVazios();
  servidor.listen(PORTA, () => {
    console.log('🚀 Chat rodando em http://localhost:%d', PORTA);
  });
}

if (require.main === module) {
  iniciar().catch((erro) => {
    console.error('❌ Erro ao iniciar:', erro.message);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await client.shutdown();
    process.exit(0);
  });
}

module.exports = { bucketDaData, bucketAnterior, cqlComValores, formatarValorCql, prepararBanco, preencherCanaisVazios, CQL };
