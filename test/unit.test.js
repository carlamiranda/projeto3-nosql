// Testes das funções que não precisam do Cassandra:  npm test
const test = require('node:test');
const assert = require('node:assert');
const { bucketDaData, bucketAnterior, cqlComValores, emFila, reacaoValida } = require('../server');

test('bucket é o mês no formato AAAAMM (UTC)', () => {
  assert.strictEqual(bucketDaData(new Date('2026-11-17T12:00:00Z')), 202611);
  assert.strictEqual(bucketDaData(new Date('2026-12-31T23:59:59Z')), 202612);
});

test('bucket anterior vira o ano em janeiro', () => {
  assert.strictEqual(bucketAnterior(202611), 202610);
  assert.strictEqual(bucketAnterior(202701), 202612);
});

test('CQL do console mostra os valores no lugar dos "?" e escapa aspas', () => {
  const cql = cqlComValores('UPDATE t SET texto = ?, reacoes = reacoes + ? WHERE b = ?', ["d'água", { '👍': 2 }, 202611]);
  assert.strictEqual(cql, "UPDATE t SET texto = 'd''água', reacoes = reacoes + {'👍': 2} WHERE b = 202611");
});

test('reação: emojis da página ou chaves que já existem na mensagem', () => {
  assert.ok(reacaoValida('👍', {}));
  assert.ok(reacaoValida('curtir', { curtir: 3 }));
  assert.ok(!reacaoValida('curtir', {}));
  assert.ok(!reacaoValida('toString', {}));
});

test('emFila executa uma tarefa por vez para a mesma chave', async () => {
  let contador = 0;
  const somar = () => emFila('msg', async () => {
    const lido = contador;
    await new Promise((r) => setTimeout(r, 2));
    contador = lido + 1;
  });
  await Promise.all(Array.from({ length: 20 }, somar));
  assert.strictEqual(contador, 20);
});

test('emFila continua depois de uma tarefa com erro', async () => {
  await assert.rejects(emFila('x', async () => { throw new Error('falhou'); }));
  assert.strictEqual(await emFila('x', async () => 'ok'), 'ok');
});
