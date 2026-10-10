// ここでは DOM に触らない。触ると、配置や切り抜きの計算を画面なしでテストできなくなる

// 初期状態では切り抜かない。どこを見せるかは利用者が決めるもので、最初から操作部を切り落とすと
// CoeFont側の設定(文字サイズ、Single/All、言語)に触れなくなる。
// 切り抜きは割合ではなく四辺からの余白(px)で持つ。こうすると描く大きさを変えても切った位置がずれない
// 窓の形と切り抜きの初期値は1つにまとめない。まとめると、切り抜きを初期化したときに窓の形まで戻ってしまう
export const WINDOW_DEFAULTS = { fw: 960, fh: 540 };
export const CROP_DEFAULTS = { it: 0, il: 0, ir: 0, ib: 0 };
// 重ねる配置での置き方は、見えている枠の位置と幅ではなく、窓の左上(ovX, ovY: 画面に対する割合)と
// 拡大率(ovScale: 窓の1pxが画面幅の何割か)で持つ。枠で持つと、切り抜きや窓の形を変えるたびに枠が変わり、
// 中身が動かないよう位置と幅を補正し続けなければならない
export const POS_DEFAULTS = { ovX: 0.25, ovY: 0.4, ovScale: 0.5 / WINDOW_DEFAULTS.fw };
export const DEFAULTS = { ...WINDOW_DEFAULTS, ...CROP_DEFAULTS, ...POS_DEFAULTS, subOpacity: 1, blend: 'normal', layout: 'overlay', band: 0.22 };

// 配置ごとの分岐を選択肢・領域の計算・境界線・ドラッグの各所に書かない。書くと配置を足すたびに直し漏れが出るので、
// すべてこの表から導く(axis: 境界線が区切る向き、subFirst: 字幕の領域が左/上に来るか)
export const LAYOUTS = {
  overlay: { label: 'スライドに重ねる' },
  below: { label: 'スライドの下に並べる', split: { axis: 'y', subFirst: false } },
  right: { label: 'スライドの右に並べる', split: { axis: 'x', subFirst: false } },
  left: { label: 'スライドの左に並べる', split: { axis: 'x', subFirst: true } },
};
export const BLENDS = ['normal', 'multiply', 'screen'];
export const BAND_RANGE = [0.08, 0.6];
// 高さの範囲を幅と同じにしない。左右に並べる配置では縦長に、下に並べる配置の細い領域では100px前後にしたい
export const WIN_W_RANGE = [300, 1600];
export const WIN_H_RANGE = [60, 2000];
export const MIN_PX = 40;
export const MIN_OVERLAY_WIDTH_RATIO = 0.1;
const OVERLAY_TOP_LIMIT = 0.98;
export const FIT_TOLERANCE_PX = 1;

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
export const splitOf = (cfg) => LAYOUTS[cfg.layout].split;
export const cropSize = (c) => ({ cw: c.fw - c.il - c.ir, ch: c.fh - c.it - c.ib });

// 窓の幅(fw)・高さ(fh)に指定できる範囲。窓を縮めても切り抜きは変えない(詰めて合わせると、窓を戻しても切った位置が
// 元に戻らない)ので、切り抜きが収まらなくなる大きさを下限にして、窓のほうを縮めさせない
export const windowRange = (cfg, key) => (key === 'fw'
  ? [Math.max(WIN_W_RANGE[0], cfg.il + cfg.ir + MIN_PX), WIN_W_RANGE[1]]
  : [Math.max(WIN_H_RANGE[0], cfg.it + cfg.ib + MIN_PX), WIN_H_RANGE[1]]);

// 保存値は別の版や手作業で書かれていることがあるので、読み込むときに一度だけ形を確かめる。
// 描画のたびに確かめる形にすると、実行中の計算の誤りまで黙って初期値に戻してしまい、気づけなくなる
export function load(stored) {
  // 保存値を丸ごと取り込まない。項目を変えたあとも、使わなくなった古い項目が保存され続けてしまう
  const usable = (v, d) => typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v));
  const c = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, usable(stored?.[k], d) ? stored[k] : d]));
  if (!Object.hasOwn(LAYOUTS, c.layout)) c.layout = DEFAULTS.layout;
  if (!BLENDS.includes(c.blend)) c.blend = DEFAULTS.blend;
  // 切り抜きは、窓を上限まで広げれば収まる範囲に収めておく(以降は windowRange が窓の側で辻褄を合わせる)
  c.il = clamp(c.il, 0, WIN_W_RANGE[1] - MIN_PX);
  c.ir = clamp(c.ir, 0, WIN_W_RANGE[1] - c.il - MIN_PX);
  c.it = clamp(c.it, 0, WIN_H_RANGE[1] - MIN_PX);
  c.ib = clamp(c.ib, 0, WIN_H_RANGE[1] - c.it - MIN_PX);
  // 置き方は操作のたびには確かめない(確かめると切り抜きや窓の形の変更で位置が動く)ので、画面の外へ飛んだ保存値はここで戻す
  const [minScale, maxScale] = [MIN_OVERLAY_WIDTH_RATIO / WIN_W_RANGE[1], 1 / MIN_PX];
  if (c.ovScale < minScale || c.ovScale > maxScale || Math.abs(c.ovX) > 1 || Math.abs(c.ovY) > 1) Object.assign(c, POS_DEFAULTS);
  normalize(c);
  return c;
}

export function normalize(cfg) {
  cfg.fw = clamp(cfg.fw, ...windowRange(cfg, 'fw'));
  cfg.fh = clamp(cfg.fh, ...windowRange(cfg, 'fh'));
  cfg.band = clamp(cfg.band, ...BAND_RANGE);
}

export function regions(cfg, W, H) {
  const sp = splitOf(cfg);
  if (!sp) return null;
  const horizontal = sp.axis === 'x';
  const total = horizontal ? W : H;
  const subLen = total * cfg.band;
  const along = (start, len) => (horizontal
    ? { left: start, top: 0, width: len, height: H }
    : { left: 0, top: start, width: W, height: len });
  return sp.subFirst
    ? { sub: along(0, subLen), slide: along(subLen, total - subLen) }
    : { slide: along(0, total - subLen), sub: along(total - subLen, subLen) };
}

export function place(cfg, W, H, { wholePage = false, anchor = cfg } = {}) {
  const { cw, ch } = cropSize(cfg);
  if (wholePage) {
    const scale = Math.min(W / cfg.fw, H / cfg.fh);
    return {
      scale, shift: [0, 0], slide: null, overlaid: false,
      box: { left: (W - cfg.fw * scale) / 2, top: (H - cfg.fh * scale) / 2, width: cfg.fw * scale, height: cfg.fh * scale },
    };
  }
  const shift = [-cfg.il, -cfg.it];
  const split = regions(cfg, W, H);
  if (split) {
    // 見せる範囲は利用者が決めた切り抜きのまま。領域に合わせて切り足しはせず、収まる大きさに拡大縮小して中央に置く。
    // 切り抜きの辺を掴んでいる間(anchor が掴んだ時点の設定)だけは、その時点の切り抜きで収めた位置と拡大率を保つ。
    // 毎回いまの切り抜きで収め直すと枠全体が動いて、掴んだ辺がマウスに付いてこなくなる
    const fit = cropSize(anchor), r = split.sub;
    const scale = Math.min(r.width / fit.cw, r.height / fit.ch);
    return {
      scale, shift, slide: split.slide, overlaid: false,
      box: {
        left: r.left + (r.width - fit.cw * scale) / 2 + (cfg.il - anchor.il) * scale,
        top: r.top + (r.height - fit.ch * scale) / 2 + (cfg.it - anchor.it) * scale,
        width: cw * scale, height: ch * scale,
      },
    };
  }
  const scale = cfg.ovScale * W;
  return {
    scale, shift, slide: null, overlaid: true,
    box: { left: cfg.ovX * W + cfg.il * scale, top: cfg.ovY * H + cfg.it * scale, width: cw * scale, height: ch * scale },
  };
}

export function fitGoal(cfg, W, H) {
  const r = regions(cfg, W, H)?.sub;
  if (!r || !(r.width > 0)) return null;
  const wanted = cfg.it + cfg.ib + cropSize(cfg).cw * r.height / r.width;
  const [lo, hi] = windowRange(cfg, 'fh');
  return { wanted, lo, hi, reachable: wanted >= lo && wanted <= hi, fits: Math.abs(wanted - cfg.fh) < FIT_TOLERANCE_PX };
}

// 枠の位置と大きさを画面の要素から読み取らない。読み取った値は整数に丸められていて、それを設定へ戻すと
// 掴むたびに拡大率や位置が少しずつずれる。掴んだ時点の設定から求めた値をそのまま使う
export function grabAt(cfg, W, H, target = {}) {
  const { box } = place(cfg, W, H);
  return { ...target, start: { ...cfg }, W, H, l: box.left, t: box.top, w: box.width, h: box.height };
}

export function dragCrop(cfg, { edge, start, W, H, l, t, w, h }, dx, dy) {
  // 拡大率を変えず、つかんだ辺だけがマウスに付いてくるようにする。反対側の切り抜きを越えない範囲で止めるので、
  // 掴んでいない辺の切り抜きには影響しない
  const { cw, ch } = cropSize(start);
  const scale = w / cw;
  if (splitOf(cfg)) {
    if (edge === 't') cfg.it = start.it + clamp(dy / scale, -start.it, ch - MIN_PX);
    else if (edge === 'b') cfg.ib = start.ib - clamp(dy / scale, -(ch - MIN_PX), start.ib);
    else if (edge === 'l') cfg.il = start.il + clamp(dx / scale, -start.il, cw - MIN_PX);
    else cfg.ir = start.ir - clamp(dx / scale, -(cw - MIN_PX), start.ir);
    return;
  }
  // 重ねる配置では枠の置き方に手を入れないので、枠が画面からはみ出していることがある(窓を広げたあとなど)。
  // そのとき掴めるのは画面の端に見えている辺なので、はみ出した辺そのものではなく、見えている端から動かす。
  // 切り抜きを戻すほうも、画面の端までで止める(その先は掴めなくなる)
  const over = { t: Math.max(0, -t), l: Math.max(0, -l), b: Math.min(0, H - (t + h)), r: Math.min(0, W - (l + w)) };
  const room = { t: t / scale, l: l / scale, b: (H - t - h) / scale, r: (W - l - w) / scale };
  // 枠が掴めないほど細くなる手前でも止める
  const minW = Math.max(MIN_PX, MIN_OVERLAY_WIDTH_RATIO * W / scale);
  if (edge === 't') cfg.it = start.it + clamp((dy + over.t) / scale, -Math.min(start.it, room.t), ch - MIN_PX);
  else if (edge === 'b') cfg.ib = start.ib - clamp((dy + over.b) / scale, -(ch - MIN_PX), Math.min(start.ib, room.b));
  else if (edge === 'l') cfg.il = start.il + clamp((dx + over.l) / scale, -Math.min(start.il, room.l), cw - minW);
  else cfg.ir = start.ir - clamp((dx + over.r) / scale, -(cw - minW), Math.min(start.ir, room.r));
}

export function dragMove(cfg, { start, W, H, l, t, w }, dx, dy) {
  cfg.ovX = start.ovX + (clamp(l + dx, 0, W - w) - l) / W;
  cfg.ovY = start.ovY + (clamp(t + dy, 0, H * OVERLAY_TOP_LIMIT) - t) / H;
}

export function dragResize(cfg, { handle, start, W, H, l, t, w, h }, dx) {
  const west = handle.includes('w'), north = handle.includes('n');
  // 縦横比は字幕の範囲で決まるので幅だけ動かし、掴んだ角の対角を固定する
  const fixedX = west ? l + w : l, fixedY = north ? t + h : t;
  // 枠が画面からはみ出しているとき、掴めるのは画面の端に見えている角なので、見えている幅から動かす
  const visible = west ? fixedX - Math.max(l, 0) : Math.min(l + w, W) - fixedX;
  // 画面の左・右・上へははみ出させない。はみ出した側のつまみが掴めなくなる
  const limit = Math.min(west ? fixedX : W - fixedX, north ? fixedY * w / h : Infinity);
  const width = clamp(visible + (west ? -dx : dx), W * MIN_OVERLAY_WIDTH_RATIO, limit);
  const scale = width / cropSize(start).cw;
  cfg.ovScale = scale / W;
  cfg.ovX = ((west ? fixedX - width : fixedX) - start.il * scale) / W;
  cfg.ovY = ((north ? fixedY - width * h / w : fixedY) - start.it * scale) / H;
}

export function dragDivider(cfg, fx, fy) {
  const sp = splitOf(cfg);
  if (!sp) return;
  const f = sp.axis === 'x' ? fx : fy;
  cfg.band = sp.subFirst ? f : 1 - f;
}
