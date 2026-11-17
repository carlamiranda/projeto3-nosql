// Teste ponta a ponta do CRUD, com o chat e o Cassandra rodando:
//   docker compose up -d   (espere o chat ligar)   e depois   npm run test:e2e
// Usa dois "navegadores" (clientes Socket.IO) ao mesmo tempo.
const test = require('node:test');
const assert = require('node:assert');
const { io } = require('socket.io-client');

const URL = process.env.URL || 'http://localhost:3000';
const pedir = (s, evento, dados) => new Promise((r) => s.emit(evento, dados, r));
const CANAL = 'geral';

test('CRUD completo pelo chat, em tempo real', async (t) => {
  const a = io(URL, { reconnection: false });
  const b = io(URL, { reconnection: false });
  t.after(() => { a.close(); b.close(); });
  await Promise.all([a, b].map((s) => new Promise((ok, erro) => {
    s.on('connect', ok);
    s.on('connect_error', () => erro(new Error(`Chat não respondeu em ${URL}. Rodou "docker compose up"?`)));
  })));

  const operacoes = new Set();
  a.on('cql', (x) => operacoes.add(x.operacao));

  // R - leitura
  await pedir(a, 'entrar_canal', { canal: CANAL });
  const lido = await pedir(b, 'entrar_canal', { canal: CANAL });
  assert.ok(lido.ok && Array.isArray(lido.mensagens));

  // C - inserção, chegando no outro cliente
  const chegou = new Promise((r) => b.once('nova_mensagem', r));
  assert.ok((await pedir(a, 'enviar', { canal: CANAL, autor: 'teste-a', texto: 'olá' })).ok);
  const msg = await chegou;
  assert.strictEqual(msg.texto, 'olá');
  const ref = { canal: msg.canal, bucket: msg.bucket, id: msg.id };

  // U - atualização (só o autor pode)
  assert.ok(!(await pedir(b, 'editar', { ...ref, autor: 'teste-b', texto: 'x' })).ok);
  assert.ok((await pedir(a, 'editar', { ...ref, autor: 'teste-a', texto: 'olá, editado' })).ok);

  // Alteração: ALTER TABLE adiciona a coluna, e a estrutura nova chega nos dois clientes
  const estruturaInicial = await new Promise((r) => {
    const c = io(URL, { reconnection: false });
    c.once('estrutura', (e) => { c.close(); r(e); });
  });
  const coluna = estruturaInicial.colunaAlteracao.nome;
  if (estruturaInicial.temColunaAlteracao) { // sobrou de um ensaio: volta ao início
    assert.ok((await pedir(a, 'alterar_tabela', { acao: 'remover' })).ok);
  }
  const estruturaNova = new Promise((r) => b.on('estrutura', (e) => { if (e.temColunaAlteracao) r(e); }));
  assert.ok((await pedir(a, 'alterar_tabela', { acao: 'adicionar' })).ok);
  assert.ok((await estruturaNova).colunas.some((c) => c.nome === coluna), 'coluna nova não apareceu');
  assert.ok(!(await pedir(a, 'alterar_tabela', { acao: 'adicionar' })).ok, 'ADD repetido deveria falhar');
  // a mensagem continua legível depois do ALTER
  assert.ok((await pedir(a, 'entrar_canal', { canal: CANAL })).mensagens.some((m) => m.id === msg.id));
  if (!estruturaInicial.temColunaAlteracao) { // deixa a tabela como estava
    assert.ok((await pedir(a, 'alterar_tabela', { acao: 'remover' })).ok);
  }

  // Extra: 20 reações ao mesmo tempo, de dois clientes, não podem se perder
  await Promise.all(Array.from({ length: 20 }, (_, i) => pedir(i % 2 ? a : b, 'reagir', { ...ref, emoji: '👍' })));
  const depois = (await pedir(a, 'entrar_canal', { canal: CANAL })).mensagens.find((m) => m.id === msg.id);
  assert.strictEqual(depois.texto, 'olá, editado');
  assert.ok(depois.editada);
  assert.strictEqual(depois.reacoes['👍'], 20);

  // D - exclusão (só o autor pode) e nada de "ressuscitar" a mensagem com UPDATE
  assert.ok(!(await pedir(b, 'apagar', { ...ref, autor: 'teste-b' })).ok);
  assert.ok((await pedir(a, 'apagar', { ...ref, autor: 'teste-a' })).ok);
  assert.ok(!(await pedir(a, 'editar', { ...ref, autor: 'teste-a', texto: 'zumbi' })).ok);

  // Inserção com TTL
  const temp = new Promise((r) => b.once('nova_mensagem', r));
  await pedir(a, 'enviar', { canal: CANAL, autor: 'teste-a', texto: 'some em 60 s', temporaria: true });
  assert.strictEqual((await temp).ttl, 60);

  for (const op of ['READ', 'CREATE', 'UPDATE', 'ALTER', 'DELETE']) assert.ok(operacoes.has(op), `console sem ${op}`);
});
