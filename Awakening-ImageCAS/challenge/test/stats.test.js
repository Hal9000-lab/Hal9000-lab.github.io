// node test/stats.test.js
const S = require("../js/stats.js"), assert = require("assert");
assert.strictEqual(S.median([3, 1, 2]), 2); assert.strictEqual(S.median([4, 1, 2, 3]), 2.5);
const sm = S.summary([1, 2, 3, 10]); assert.deepStrictEqual([sm.n, sm.mean, sm.median, sm.min, sm.max], [4, 4, 2.5, 1, 10]);
const st = S.sideStats([{ R: 1, L: 3 }, { R: 2, L: 5 }, { R: 3, L: 1 }]);
assert.strictEqual(st.R.median, 2); assert.strictEqual(st.L.median, 3); assert.strictEqual(st.both.n, 6); assert.strictEqual(st.both.median, 2.5); assert.strictEqual(st.both.max, 5);
const scored = Array.from({ length: 12 }, (_, i) => "s" + i), pool = Array.from({ length: 8 }, (_, i) => "a" + i);
for (let seed = 1; seed < 50; seed++) {
    const q = S.buildSequence(scored, pool, S.rng(seed));
    assert.strictEqual(q.length, 15);
    assert.deepStrictEqual(q.map(x => x.kind[0]).join(""), "sssssssssSAsAsA".toLowerCase().replace("sssssssss", "sssssssss").replace("sasasa", "sasasa"));
    assert.strictEqual(new Set(q.map(x => x.token)).size, 15);
    assert.strictEqual(q.filter(x => x.kind === "scored").length, 12);
}
const q = S.buildSequence(scored, pool, S.rng(7)); assert.deepStrictEqual(q.slice(9).map(x => x.kind), ["scored", "alcapa", "scored", "alcapa", "scored", "alcapa"]);
const r = S.rank([{ both: { median: 2, mean: 2 } }, { both: { median: 1, mean: 5 } }, { both: { median: 1, mean: 3 } }]);
assert.deepStrictEqual(r.map(x => x.both.mean), [3, 5, 2]);
assert.ok(Math.abs(S.euclid([0, 0, 0], [1, 2, 2]) - 3) < 1e-12);
console.log("stats tests ok");
