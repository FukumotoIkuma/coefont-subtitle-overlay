import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, WIN_H_RANGE, MIN_PX, MIN_OVERLAY_WIDTH_RATIO,
  load, normalize, regions, place, fitGoal, cropSize, dragCrop, dragMove, dragResize, dragDivider,
} from '../src/model.js';

const W = 1600, H = 900;
const config = (over = {}) => ({ ...DEFAULTS, ...over });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

// 掴んだ時点の状態。枠の位置と大きさは、その時点の配置から求める
function grabOf(cfg, extra) {
  const { box } = place(cfg, W, H);
  return { start: { ...cfg }, W, H, l: box.left, t: box.top, w: box.width, h: box.height, ...extra };
}

test('保存値がなければ初期値で始まる', () => {
  assert.deepEqual(load(null), DEFAULTS);
});

test('保存値のうち、知っている項目だけを引き継ぐ', () => {
  const cfg = load({ band: 0.4, layout: 'right', obsolete: 1, x: 0.5 });
  assert.equal(cfg.band, 0.4);
  assert.equal(cfg.layout, 'right');
  assert.deepEqual(Object.keys(cfg).sort(), Object.keys(DEFAULTS).sort());
});

test('壊れた保存値は、その項目だけ初期値に戻る', () => {
  const cfg = load({ fw: 'wide', band: null, subOpacity: NaN, layout: 'toString', blend: 7, fh: 300 });
  assert.equal(cfg.fw, DEFAULTS.fw);
  assert.equal(cfg.band, DEFAULTS.band);
  assert.equal(cfg.subOpacity, DEFAULTS.subOpacity);
  assert.equal(cfg.layout, DEFAULTS.layout);
  assert.equal(cfg.blend, DEFAULTS.blend);
  assert.equal(cfg.fh, 300);
});

test('重ねる配置では、スライドは全面のままで字幕は指定した位置と幅に出る', () => {
  const cfg = config({ subX: 0.1, subY: 0.5, subW: 0.5 });
  const p = place(cfg, W, H);
  assert.equal(p.slide, null);
  assert.equal(p.overlaid, true);
  near(p.box.left, 160);
  near(p.box.top, 450);
  near(p.box.width, 800);
  near(p.box.height, 800 * 540 / 960);
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

test('重ねる配置で切り抜いても、中身の大きさと反対側の辺の位置は変わらない', () => {
  const cfg = config({ subX: 0.2, subY: 0.3, subW: 0.5 });
  const before = place(cfg, W, H);
  dragCrop(cfg, grabOf(cfg, { edge: 'l' }), 80, 0);
  normalize(cfg);
  const after = place(cfg, W, H);
  near(after.scale, before.scale, '拡大率');
  near(after.box.left, before.box.left + 80, '左辺');
  near(after.box.left + after.box.width, before.box.left + before.box.width, '右辺');
});

test('重ねる配置の切り抜きは、枠が最小の幅になったところで止まる', () => {
  const cfg = config({ subX: 0.3, subY: 0.3, subW: 0.2 });
  const before = place(cfg, W, H);
  dragCrop(cfg, grabOf(cfg, { edge: 'l' }), 5000, 0);
  normalize(cfg);
  const after = place(cfg, W, H);
  near(after.box.width, W * MIN_OVERLAY_WIDTH_RATIO);
  near(after.scale, before.scale, '拡大率');
});

test('字幕の枠を動かすと、マウスと同じだけ位置が変わる', () => {
  const cfg = config({ subX: 0.25, subY: 0.3, subW: 0.5 });
  dragMove(cfg, grabOf(cfg), -80, 45);
  near(cfg.subX, 0.2);
  near(cfg.subY, 0.35);
});

test('角を動かすと、対角を固定したまま縦横比を保って大きさが変わる', () => {
  const cfg = config({ subX: 0.25, subY: 0.3, subW: 0.5 });
  const before = place(cfg, W, H).box;
  dragResize(cfg, grabOf(cfg, { handle: 'nw' }), -160);
  const after = place(cfg, W, H).box;
  near(after.width, before.width + 160);
  near(after.width / after.height, before.width / before.height, '縦横比');
  near(after.left + after.width, before.left + before.width, '右辺');
  near(after.top + after.height, before.top + before.height, '下辺');
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
