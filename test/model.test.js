import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, WIN_H_RANGE, MIN_PX, MIN_OVERLAY_WIDTH_RATIO,
  load, normalize, regions, place, fitGoal, cropSize, grabAt, dragCrop, dragMove, dragResize, dragDivider,
} from '../src/model.js';

const W = 1600, H = 900;
const config = (over = {}) => ({ ...DEFAULTS, ...over });
// 重ねる配置で、枠が (left, top) から幅 width で見えるような置き方(切り抜きなしの初期の窓 960×540 に対して)
const overlayAt = (left, top, width) => ({ ovX: left / W, ovY: top / H, ovScale: width / 960 / W });
const placement = (cfg) => [cfg.ovX, cfg.ovY, cfg.ovScale];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

const grabOf = (cfg, target) => grabAt(cfg, W, H, target);

test('保存値がなければ初期値で始まる', () => {
  assert.deepEqual(load(null), DEFAULTS);
});

test('保存値のうち、知っている項目だけを引き継ぐ', () => {
  const cfg = load({ band: 0.4, layout: 'right', obsolete: 1, x: 0.5 });
  assert.equal(cfg.band, 0.4);
  assert.equal(cfg.layout, 'right');
  assert.deepEqual(Object.keys(cfg).sort(), Object.keys(DEFAULTS).sort());
});

for (const [what, stored] of [
  ['画面の外へ飛んだ位置', { ovX: 40, ovY: 0.2, ovScale: 0.001 }],
  ['画面に収まらないほど大きい拡大率', { ovX: 0.2, ovY: 0.2, ovScale: 5 }],
  ['見えないほど小さい拡大率', { ovX: 0.2, ovY: 0.2, ovScale: 1e-9 }],
]) {
  test(`保存値の置き方が「${what}」なら、初期の置き方に戻る`, () => {
    assert.deepEqual(placement(load(stored)), placement(DEFAULTS));
  });
}

test('壊れた保存値は、その項目だけ初期値に戻る', () => {
  const cfg = load({ fw: 'wide', band: null, subOpacity: NaN, layout: 'toString', blend: 7, fh: 300 });
  assert.equal(cfg.fw, DEFAULTS.fw);
  assert.equal(cfg.band, DEFAULTS.band);
  assert.equal(cfg.subOpacity, DEFAULTS.subOpacity);
  assert.equal(cfg.layout, DEFAULTS.layout);
  assert.equal(cfg.blend, DEFAULTS.blend);
  assert.equal(cfg.fh, 300);
});

test('重ねる配置では、スライドは全面のままで字幕は置いた位置と大きさに出る', () => {
  const p = place(config(overlayAt(160, 450, 800)), W, H);
  assert.equal(p.slide, null);
  assert.equal(p.overlaid, true);
  near(p.box.left, 160);
  near(p.box.top, 450);
  near(p.box.width, 800);
  near(p.box.height, 800 * 540 / 960);
});

test('重ねる配置で窓の形を変えても、文字の大きさ(拡大率)と窓の位置は変わらない', () => {
  const cfg = config(overlayAt(160, 450, 800));
  const before = place(cfg, W, H);
  cfg.fw = 480;
  cfg.fh = 700;
  normalize(cfg);
  const after = place(cfg, W, H);
  near(after.scale, before.scale, '拡大率');
  near(after.box.left, before.box.left, '左辺');
  near(after.box.top, before.box.top, '上辺');
  near(after.box.width, before.box.width / 2, '枠の幅');
});

for (const [layout, slide, sub] of [
  ['below', { left: 0, top: 0, width: W, height: 675 }, { left: 0, top: 675, width: W, height: 225 }],
  ['right', { left: 0, top: 0, width: 1200, height: H }, { left: 1200, top: 0, width: 400, height: H }],
  ['left', { left: 400, top: 0, width: 1200, height: H }, { left: 0, top: 0, width: 400, height: H }],
]) {
  test(`「${layout}」の配置では、画面がスライドの領域と字幕の領域に隙間なく分かれる`, () => {
    const r = regions(config({ layout, band: 0.25 }), W, H);
    assert.deepEqual(r.slide, slide);
    assert.deepEqual(r.sub, sub);
  });
}

test('並べる配置では、切り抜いた範囲が字幕の領域に収まる大きさで中央に置かれる', () => {
  const cfg = config({ layout: 'right', band: 0.25, fw: 400, fh: 400 });
  const { box, slide, overlaid } = place(cfg, W, H);
  assert.equal(overlaid, false);
  assert.deepEqual(slide, { left: 0, top: 0, width: 1200, height: H });
  near(box.width, 400);
  near(box.height, 400);
  near(box.left, 1200);
  near(box.top, 250);
});

test('境界線を動かしても、切り抜きと窓の形は変わらない', () => {
  const cfg = config({ layout: 'below', it: 118, ib: 30, il: 10, ir: 20, fw: 800, fh: 500 });
  const before = { ...cfg };
  dragDivider(cfg, 0.5, 0.6);
  normalize(cfg);
  near(cfg.band, 0.4);
  for (const k of ['it', 'ib', 'il', 'ir', 'fw', 'fh']) assert.equal(cfg[k], before[k], k);
});

test('左に並べる配置では、境界線の位置がそのまま字幕の領域の幅になる', () => {
  const cfg = config({ layout: 'left' });
  dragDivider(cfg, 0.35, 0.9);
  near(cfg.band, 0.35);
});

test('窓を縮めても切り抜きは変わらず、切り抜きが収まらない大きさには縮まない', () => {
  const cfg = config({ it: 118, ib: 30, il: 100, ir: 50 });
  cfg.fh = 60;
  cfg.fw = 100;
  normalize(cfg);
  assert.equal(cfg.fh, 118 + 30 + MIN_PX);
  assert.equal(cfg.fw, 300);
  assert.deepEqual([cfg.it, cfg.ib, cfg.il, cfg.ir], [118, 30, 100, 50]);
});

test('並べる配置で切り抜きの辺を動かしている間は、掴んだ辺だけがマウスと同じだけ動く', () => {
  const cfg = config({ layout: 'right', band: 0.4, fw: 400, fh: 750, ib: 200 });
  const grab = grabOf(cfg, { edge: 't' });
  const before = place(cfg, W, H).box;
  dragCrop(cfg, grab, 0, 60);
  const during = place(cfg, W, H, { anchor: grab.start }).box;
  near(during.top, before.top + 60, '上辺');
  near(during.top + during.height, before.top + before.height, '下辺');
  near(during.left, before.left, '左辺');
});

test('切り抜きの辺を離すと、新しい切り抜きで字幕の領域の中央に収め直される', () => {
  const cfg = config({ layout: 'right', band: 0.4, fw: 400, fh: 750, ib: 200 });
  dragCrop(cfg, grabOf(cfg, { edge: 't' }), 0, 60);
  const { box } = place(cfg, W, H);
  const region = regions(cfg, W, H).sub;
  near(box.top - region.top, region.top + region.height - (box.top + box.height), '上下の余白');
});

test('切り抜きの辺を大きく動かしても、反対側の切り抜きは残る', () => {
  const cfg = config({ layout: 'right', band: 0.4, fw: 400, fh: 750, ib: 200 });
  dragCrop(cfg, grabOf(cfg, { edge: 't' }), 0, 5000);
  normalize(cfg);
  assert.equal(cfg.ib, 200);
  near(cropSize(cfg).ch, MIN_PX);
});

test('重ねる配置で切り抜いても、置き方は変わらず、掴んだ辺だけがマウスと同じだけ動く', () => {
  const cfg = config(overlayAt(320, 270, 800));
  const before = place(cfg, W, H);
  const placed = placement(cfg);
  dragCrop(cfg, grabOf(cfg, { edge: 'l' }), 80, 0);
  normalize(cfg);
  const after = place(cfg, W, H);
  assert.deepEqual(placement(cfg), placed);
  near(after.scale, before.scale, '拡大率');
  near(after.box.left, before.box.left + 80, '左辺');
  near(after.box.left + after.box.width, before.box.left + before.box.width, '右辺');
});

test('重ねる配置の切り抜きは、枠が最小の幅になったところで止まる', () => {
  const cfg = config(overlayAt(480, 270, 320));
  dragCrop(cfg, grabOf(cfg, { edge: 'l' }), 5000, 0);
  normalize(cfg);
  near(place(cfg, W, H).box.width, W * MIN_OVERLAY_WIDTH_RATIO);
});

test('重ねる配置で切り抜きを戻すとき、枠は画面の端で止まり、置き方は変わらない', () => {
  // 左を 480px 切った状態で、枠の左辺が画面の左端から 100px のところにある
  const cfg = config({ ...overlayAt(-300, 270, 800), il: 480 });
  const placed = placement(cfg);
  near(place(cfg, W, H).box.left, 100);
  dragCrop(cfg, grabOf(cfg, { edge: 'l' }), -5000, 0);
  normalize(cfg);
  near(place(cfg, W, H).box.left, 0);
  assert.deepEqual(placement(cfg), placed);
});

test('字幕の枠を動かすと、マウスと同じだけ位置が変わり、大きさは変わらない', () => {
  const cfg = config(overlayAt(400, 270, 800));
  const before = place(cfg, W, H);
  dragMove(cfg, grabOf(cfg), -80, 45);
  const after = place(cfg, W, H);
  near(after.box.left, before.box.left - 80);
  near(after.box.top, before.box.top + 45);
  near(after.scale, before.scale, '拡大率');
});

test('字幕の枠を何度動かしても、文字の大きさ(拡大率)は変わらない', () => {
  const cfg = config({ ...overlayAt(400.4, 270.3, 801.7), il: 33.3 });
  const scale = cfg.ovScale;
  for (const [dx, dy] of [[13, 7], [-29, 11], [5, -17], [-3, 2]]) dragMove(cfg, grabOf(cfg), dx, dy);
  assert.equal(cfg.ovScale, scale);
});

test('字幕の枠は、動かしても画面の左右の外へは出ない', () => {
  const cfg = config(overlayAt(400, 270, 800));
  dragMove(cfg, grabOf(cfg), 5000, 0);
  const { box } = place(cfg, W, H);
  near(box.left + box.width, W);
});

test('切り抜いた字幕の枠を動かしても、切り抜きは変わらない', () => {
  const cfg = config({ ...overlayAt(400, 270, 800), it: 118, il: 40 });
  const before = place(cfg, W, H);
  dragMove(cfg, grabOf(cfg), 30, -20);
  const after = place(cfg, W, H);
  assert.deepEqual([cfg.it, cfg.il, cfg.ir, cfg.ib], [118, 40, 0, 0]);
  near(after.box.left, before.box.left + 30);
  near(after.box.top, before.box.top - 20);
});

test('角を動かすと、対角を固定したまま縦横比を保って大きさが変わる', () => {
  const cfg = config({ ...overlayAt(400, 270, 800), it: 118, il: 40 });
  const before = place(cfg, W, H).box;
  dragResize(cfg, grabOf(cfg, { handle: 'nw' }), -160);
  const after = place(cfg, W, H).box;
  near(after.width, before.width + 160);
  near(after.width / after.height, before.width / before.height, '縦横比');
  near(after.left + after.width, before.left + before.width, '右辺');
  near(after.top + after.height, before.top + before.height, '下辺');
});

test('角を大きく動かしても、枠は画面の左・右・上の外へは広がらない', () => {
  const cfg = config(overlayAt(400, 270, 800));
  dragResize(cfg, grabOf(cfg, { handle: 'sw' }), -5000);
  near(place(cfg, W, H).box.left, 0, '左辺');

  const toRight = config(overlayAt(400, 270, 800));
  dragResize(toRight, grabOf(toRight, { handle: 'se' }), 5000);
  const right = place(toRight, W, H).box;
  near(right.left + right.width, W, '右辺');

  const toTop = config(overlayAt(100, 270, 800));
  dragResize(toTop, grabOf(toTop, { handle: 'ne' }), 5000);
  near(place(toTop, W, H).box.top, 0, '上辺');
});

test('窓を広げて枠が画面の右へはみ出しても、置き方と切り抜きは変わらない', () => {
  const cfg = config(overlayAt(600, 270, 800));
  const placed = placement(cfg);
  cfg.fw = 1600;
  normalize(cfg);
  const { box } = place(cfg, W, H);
  assert.ok(box.left + box.width > W);
  assert.deepEqual(placement(cfg), placed);
  assert.deepEqual([cfg.it, cfg.il, cfg.ir, cfg.ib], [0, 0, 0, 0]);
});

test('画面からはみ出した枠の辺を掴むと、画面の端に見えている位置から切り抜きが動く', () => {
  const cfg = config({ ...overlayAt(600, 270, 800), fw: 1600 });
  const before = place(cfg, W, H);
  const overflow = before.box.left + before.box.width - W;
  dragCrop(cfg, grabOf(cfg, { edge: 'r' }), -50, 0);
  const after = place(cfg, W, H);
  near(after.box.left + after.box.width, W - 50, '右辺');
  near(cfg.ir, (overflow + 50) / before.scale, '切り抜いた量');
  near(after.scale, before.scale, '拡大率');
  near(after.box.left, before.box.left, '左辺');
});

test('画面からはみ出した枠の角を掴むと、画面の端に見えている位置から大きさが変わる', () => {
  const cfg = config({ ...overlayAt(600, 270, 800), fw: 1600 });
  dragResize(cfg, grabOf(cfg, { handle: 'se' }), -100);
  const { box } = place(cfg, W, H);
  near(box.left, 600, '左辺');
  near(box.left + box.width, W - 100, '右辺');
});

test('重ねる配置では、領域に合わせる高さは求まらない', () => {
  assert.equal(fitGoal(config(), W, H), null);
});

test('合わせる高さにすると、切り抜いた範囲が字幕の領域をちょうど埋める', () => {
  const cfg = config({ layout: 'right', band: 0.25, fw: 400, fh: 540, it: 100, il: 20 });
  const goal = fitGoal(cfg, W, H);
  assert.equal(goal.reachable, true);
  assert.equal(goal.fits, false);
  cfg.fh = goal.wanted;
  normalize(cfg);
  const { box } = place(cfg, W, H);
  const region = regions(cfg, W, H).sub;
  for (const k of ['left', 'top', 'width', 'height']) near(box[k], region[k], k);
  assert.equal(fitGoal(cfg, W, H).fits, true);
});

test('合わせる高さが指定できる範囲の外なら、そう分かる', () => {
  const tooShort = fitGoal(config({ layout: 'below', band: 0.08, fw: 300 }), W, H);
  assert.equal(tooShort.reachable, false);
  assert.equal(tooShort.lo, WIN_H_RANGE[0]);

  const blockedByCrop = fitGoal(config({ layout: 'below', band: 0.08, fw: 300, it: 100 }), W, H);
  assert.equal(blockedByCrop.reachable, false);
  assert.equal(blockedByCrop.lo, 100 + MIN_PX);
});

test('CoeFontの画面全体の表示では、切り抜かずに画面へ収まる大きさで中央に出る', () => {
  const cfg = config({ layout: 'below', it: 118, fw: 800, fh: 300 });
  const { box, shift, slide } = place(cfg, W, H, { wholePage: true });
  assert.deepEqual(shift, [0, 0]);
  assert.equal(slide, null);
  near(box.width, W);
  near(box.height, 600);
  near(box.top, 150);
});
