// 件数校验：纯逻辑测试（node tests/item-count.test.mjs）
// 起因：Depop bundle 订单写着「2 items sold」，旧版只读到 1 件，打包清单上就只有一件，员工会少寄。
import assert from 'node:assert';
import { countProblem, assignCodes } from '../lib/report.js';
import { holdBadCounts } from '../lib/package.js';

const row = (id, orderId, extra = {}) => ({ id, platform: 'depop', orderId, qty: 1, title: id, addedAt: 1, ...extra });

// 平台写着 2 件，只读到 1 件：不打包
assert.match(countProblem([row('a', '1', { expectedItems: 2 })]), /平台写着 2 件，只读到 1 件/);
// 读到 2 件：没问题
assert.strictEqual(countProblem([row('a', '1', { expectedItems: 2 }), row('b', '1', { expectedItems: 2 })]), '');
// 在批次页「+件」补上（手动行没有 expectedItems）或者把数量改成 2：也没问题
assert.strictEqual(countProblem([row('a', '1', { expectedItems: 2 }), row('m', '1')]), '');
assert.strictEqual(countProblem([row('a', '1', { expectedItems: 2, qty: 2 })]), '');
// 读多了也报错
assert.match(countProblem([row('a', '1', { expectedItems: 1 }), row('b', '1', { expectedItems: 1 })]), /却读到 2 件/);
// 平台件数没读到（-1）：报错；不校验的平台（没有 expectedItems）：不报
assert.match(countProblem([row('a', '1', { expectedItems: -1 })]), /没读到平台写的件数/);
assert.strictEqual(countProblem([row('a', '1')]), '');

// assignCodes 每一行带上 countError；holdBadCounts 整单挑出来
const orders = [row('a', '1', { expectedItems: 2 }), row('b', '2', { expectedItems: 2 }), row('c', '2', { expectedItems: 2 }), row('d', '3')];
assert.ok(assignCodes(orders).find((r) => r.id === 'a').countError);
assert.strictEqual(assignCodes(orders).find((r) => r.id === 'b').countError, '');
const { held, ok } = holdBadCounts(orders);
assert.deepStrictEqual(held.map((h) => h.orderId), ['1']);
assert.deepStrictEqual(ok.map((o) => o.id), ['b', 'c', 'd']);

console.log('item-count: all passed');
