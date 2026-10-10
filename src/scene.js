// スライド+字幕の合成画面を DOM に描く。手元のプレビューと出力ウィンドウの両方がこれを使う
import { place, cropSize } from './model.js';

// 手元のプレビューと出力ウィンドウは別文書なので、同じ見た目の定義を両方へ差し込む
export const SCENE_CSS = `
  .scene { position: relative; overflow: hidden; background: #000; user-select: none; touch-action: none; }
  .scene .slide { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .scene .shade { position: absolute; inset: 0; background: #000; }
  .scene .sub { position: absolute; overflow: hidden; }
  .scene .content { position: absolute; left: 0; top: 0; border: 0; background: #fff; transform-origin: 0 0; }
  .scene .ph { background: repeating-linear-gradient(45deg, #cfd6e4 0 24px, #e9edf5 24px 48px); opacity: .8; }
  .scene .crop { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .scene .outline { position: absolute; box-sizing: border-box; border: 3px solid #e5484d; pointer-events: none; }
  .scene .sel { position: absolute; border: 2px solid #2f6feb; box-shadow: 0 0 0 9999px rgba(0, 0, 0, .55); pointer-events: none; }
`;

const RECT_KEYS = ['left', 'top', 'width', 'height'];

// 出力ウィンドウ(real)にはCoeFontのiframeを置く。手元のプレビューに同じiframeを置くと二重に参加して
// 音声も二重になるので、手元は同じ寸法の代用の板で位置と範囲だけを示す
export function makeScene(doc, root, real, onSlideSizeChange) {
  root.classList.add('scene');
  const slide = doc.createElement('video');
  slide.className = 'slide';
  slide.muted = true;
  slide.playsInline = true;
  slide.autoplay = true;
  const shade = doc.createElement('div');
  shade.className = 'shade';
  const sub = doc.createElement('div');
  sub.className = 'sub';
  const content = doc.createElement(real ? 'iframe' : 'div');
  content.className = real ? 'content' : 'content ph';
  if (real) {
    content.allow = 'autoplay; microphone; clipboard-write';
    content.title = 'CoeFont';
  }
  const crop = doc.createElement('div');
  crop.className = 'crop';
  const sel = doc.createElement('div');
  sel.className = 'sel';
  crop.append(sel);
  sub.append(content, crop);
  // 透過中は字幕の枠の端が出力側で見えないので、調整している間だけ枠線を出す。合成モードが掛からないよう字幕とは別要素にする
  const outline = doc.createElement('div');
  outline.className = 'outline';
  root.prepend(slide, shade, sub, outline);
  for (const ev of ['loadedmetadata', 'resize', 'emptied']) slide.addEventListener(ev, onSlideSizeChange);
  // W, H: 直前に配置したときの大きさ。配置のあとで測り直すと再計算を強いるので、他で要るときはこれを使う
  return { doc, root, slide, shade, sub, content, crop, sel, outline, real, W: 0, H: 0 };
}

// view: { url: 字幕を読み込んだか, wholePage: 出力側をCoeFontの画面全体の表示にしているか, adjusting: 調整中か,
//         hasSlide: スライドを取り込んでいるか, anchor: 切り抜きの辺を掴んでいる間の、掴んだ時点の設定 }
export function layoutScene(sc, cfg, view) {
  const W = sc.W = sc.root.clientWidth, H = sc.H = sc.root.clientHeight;
  // 手元のプレビューまで全体表示にはしない。聴衆に見える構図を、手元では常に確かめられるようにしておく
  const wholePage = sc.real && view.wholePage;
  const { scale, box, shift, slide, overlaid } = place(cfg, W, H, { wholePage, anchor: view.anchor ?? cfg });

  // スライドの映像自体をvisibilityやopacityで隠すと、戻したあとも黒いまま再描画されない環境がある(Chromium系の組み込みブラウザで再現)。
  // 映像には触らず、上に黒い幕を掛けて隠す
  sc.shade.style.display = wholePage ? '' : 'none';
  for (const k of RECT_KEYS) sc.slide.style[k] = slide ? slide[k] + 'px' : '';

  sc.sub.style.display = view.url ? '' : 'none';
  // 出力先の大きさでCoeFont側のレイアウトが変わると切り抜きがずれるので、決めた大きさで描かせて拡大縮小だけする
  sc.content.style.width = cfg.fw + 'px';
  sc.content.style.height = cfg.fh + 'px';
  sc.content.style.transform = `scale(${scale}) translate(${shift[0]}px, ${shift[1]}px)`;
  for (const k of RECT_KEYS) sc.sub.style[k] = sc.outline.style[k] = box[k] + 'px';
  sc.outline.style.display = sc.real && view.adjusting && !wholePage && view.url ? '' : 'none';

  const { cw, ch } = cropSize(cfg);
  sc.crop.style.display = wholePage ? '' : 'none';
  sc.sel.style.left = cfg.il / cfg.fw * 100 + '%';
  sc.sel.style.top = cfg.it / cfg.fh * 100 + '%';
  sc.sel.style.width = cw / cfg.fw * 100 + '%';
  sc.sel.style.height = ch / cfg.fh * 100 + '%';

  if (sc.real) {
    const presenting = sc.doc.fullscreenElement && !wholePage;
    // 開始ボタンは字幕欄の中に出るので、字幕表示のままでも押せるようにしておく。全画面で見せている間だけ触れなくする
    sc.content.style.pointerEvents = presenting ? 'none' : 'auto';
    // 下地のスライドがないまま白地や黒地を抜くと、黒い背景に溶けて字幕ごと見えなくなる
    sc.sub.style.mixBlendMode = overlaid && view.hasSlide ? cfg.blend : 'normal';
    // 透過と不透明度は下地のスライドと重なるときだけ意味がある
    sc.sub.style.opacity = overlaid ? cfg.subOpacity : 1;
    // 全画面で字幕を出している間はカーソルを聴衆に見せない
    sc.root.style.cursor = presenting ? 'none' : '';
  }
  return box;
}
