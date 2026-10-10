// 設定と、そこから配置を求める計算。DOM には触らない(画面なしでテストできるようにしておく)

// 初期状態では切り抜かない。どこを見せるかは利用者が決めるもので、最初から操作部を切り落とすと
// CoeFont側の設定(文字サイズ、Single/All、言語)に触れなくなる。
// 切り抜きは割合ではなく四辺からの余白(px)で持つ。こうすると描く大きさを変えても切った位置がずれない
// 窓の形と切り抜きの初期値は1つにまとめない。まとめると、切り抜きを初期化したときに窓の形まで戻ってしまう
export const WINDOW_DEFAULTS = { fw: 960, fh: 540 };
export const CROP_DEFAULTS = { it: 0, il: 0, ir: 0, ib: 0 };
export const POS_DEFAULTS = { subX: 0.25, subY: 0.4, subW: 0.5 };
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
  const c = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, stored?.[k] ?? DEFAULTS[k]]));
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof c[k] !== typeof DEFAULTS[k] || (typeof c[k] === 'number' && !Number.isFinite(c[k]))) c[k] = DEFAULTS[k];
  }
  if (!Object.hasOwn(LAYOUTS, c.layout)) c.layout = DEFAULTS.layout;
  if (!BLENDS.includes(c.blend)) c.blend = DEFAULTS.blend;
  // 切り抜きは、窓を上限まで広げれば収まる範囲に収めておく(以降は windowRange が窓の側で辻褄を合わせる)
  c.il = clamp(c.il, 0, WIN_W_RANGE[1] - MIN_PX);
  c.ir = clamp(c.ir, 0, WIN_W_RANGE[1] - c.il - MIN_PX);
  c.it = clamp(c.it, 0, WIN_H_RANGE[1] - MIN_PX);
  c.ib = clamp(c.ib, 0, WIN_H_RANGE[1] - c.it - MIN_PX);
  normalize(c);
  return c;
}

export function normalize(cfg) {
  cfg.fw = clamp(cfg.fw, ...windowRange(cfg, 'fw'));
  cfg.fh = clamp(cfg.fh, ...windowRange(cfg, 'fh'));
  cfg.band = clamp(cfg.band, ...BAND_RANGE);
  cfg.subW = clamp(cfg.subW, MIN_OVERLAY_WIDTH_RATIO, 1);
  cfg.subX = clamp(cfg.subX, 0, 1 - cfg.subW);
  cfg.subY = clamp(cfg.subY, 0, 0.98);
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

// W×H の画面に字幕(CoeFontの窓)をどう置くか。box: 見せる範囲の枠、scale: 窓の拡大率、shift: 窓の中での切り抜きのずらし、
// slide: スライドの領域(全面なら null)
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
  const width = cfg.subW * W, scale = width / cw;
  return { scale, shift, slide: null, overlaid: true, box: { left: cfg.subX * W, top: cfg.subY * H, width, height: ch * scale } };
}

// 並べる配置で、切り抜いた残りが W×H の画面の字幕の領域と同じ縦横比になる窓の高さ(wanted)と、
// それを指定できるか・いま合っているか。並べる配置でないとき、領域がまだ大きさを持たないときは null
export function fitGoal(cfg, W, H) {
  const r = regions(cfg, W, H)?.sub;
  if (!r || !(r.width > 0)) return null;
  const wanted = cfg.it + cfg.ib + cropSize(cfg).cw * r.height / r.width;
  const [lo, hi] = windowRange(cfg, 'fh');
  return { wanted, lo, hi, reachable: wanted >= lo && wanted <= hi, fits: Math.abs(wanted - cfg.fh) < FIT_TOLERANCE_PX };
}

// 以下のドラッグは、掴んだ時点の状態 grab = { start: 設定の写し, W, H: プレビューの大きさ, l, t, w, h: 枠の位置と大きさ }
// と、そこからのマウスの移動量 (dx, dy) で設定を書き換える

export function dragCrop(cfg, { edge, start, W, H, w }, dx, dy) {
  // 拡大率を変えず、つかんだ辺だけがマウスに付いてくるようにする。反対側の切り抜きを越えない範囲で止めるので、
  // 掴んでいない辺の切り抜きには影響しない
  const { cw, ch } = cropSize(start);
  const scale = w / cw;
  const overlaid = !splitOf(cfg);
  // 重ねる配置では枠の幅に下限があり、それを割ると拡大率のほうが変わって掴んだ辺が付いてこなくなるので、その手前で止める
  const minW = overlaid ? Math.max(MIN_PX, MIN_OVERLAY_WIDTH_RATIO * W / scale) : MIN_PX;
  let d;
  if (edge === 't') {
    d = clamp(dy / scale, -start.it, ch - MIN_PX);
    cfg.it = start.it + d;
  } else if (edge === 'b') {
    d = clamp(dy / scale, -(ch - MIN_PX), start.ib);
    cfg.ib = start.ib - d;
  } else if (edge === 'l') {
    d = clamp(dx / scale, -start.il, cw - minW);
    cfg.il = start.il + d;
  } else {
    d = clamp(dx / scale, -(cw - minW), start.ir);
    cfg.ir = start.ir - d;
  }
  // 重ねる配置は枠の位置と幅を設定として持っているので、中身と反対側の辺が動かないよう合わせて直す。
  // 並べる配置は、掴んでいる間は掴んだ時点の切り抜きで収めたままにしてある(place の anchor)ので、切り抜きを変えるだけでよい
  if (overlaid) {
    if (edge === 't') cfg.subY = start.subY + d * scale / H;
    else if (edge === 'l') { cfg.subX = start.subX + d * scale / W; cfg.subW = (cw - d) * scale / W; }
    else if (edge === 'r') cfg.subW = (cw + d) * scale / W;
  }
}

export function dragMove(cfg, { W, H, l, t }, dx, dy) {
  cfg.subX = (l + dx) / W;
  cfg.subY = (t + dy) / H;
}

export function dragResize(cfg, { handle, W, H, l, t, w, h }, dx) {
  // 縦横比は字幕の範囲で決まるので幅だけ動かし、掴んだ角の対角を固定する
  const nw = clamp(handle.includes('w') ? w - dx : w + dx, W * MIN_OVERLAY_WIDTH_RATIO, W);
  const nh = nw * h / w;
  cfg.subW = nw / W;
  cfg.subX = (handle.includes('w') ? l + w - nw : l) / W;
  cfg.subY = (handle.includes('n') ? t + h - nh : t) / H;
}

// 境界線を、プレビュー上の位置 (fx, fy: 左上を0、右下を1とする割合) へ動かす
export function dragDivider(cfg, fx, fy) {
  const sp = splitOf(cfg);
  if (!sp) return;
  const f = sp.axis === 'x' ? fx : fy;
  cfg.band = sp.subFirst ? f : 1 - f;
}
