import {
  LAYOUTS, CROP_DEFAULTS, WINDOW_DEFAULTS, POS_DEFAULTS, WIN_W_RANGE, WIN_H_RANGE,
  load, normalize, splitOf, fitGoal, grabAt, dragCrop, dragMove, dragResize, dragDivider,
} from './model.js';
import { SCENE_CSS, makeScene, layoutScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'coefont-subtitle-overlay';
const URL_KEY = 'coefont-subtitle-overlay:url';
const WINDOW_SLIDERS = [
  { input: 'winW', output: 'oWinW', key: 'fw', range: WIN_W_RANGE, name: '幅' },
  { input: 'winH', output: 'oWinH', key: 'fh', range: WIN_H_RANGE, name: '高さ' },
];
const OUTPUT_CSS = `
  html, body { margin: 0; height: 100%; background: #000; }
  #root { position: absolute; inset: 0; }
  #bar { position: absolute; left: 0; right: 0; top: 0; padding: 8px; display: flex; gap: 12px; align-items: center; justify-content: center;
         font: 14px system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, .75); }
  #bar button { font: inherit; padding: 6px 14px; border-radius: 5px; border: 0; background: #2f6feb; color: #fff; cursor: pointer; }
  #bar button.sub { background: #444; }
`;

const cfg = load((() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } })());

let showWholePage = false;
let url = null;
let adjusting = false;
let adjustTimer = 0;
let slideStream = null;
let out = null; // 出力ウィンドウ { win, fullBtn, scene }
let grab = null; // 字幕の枠を掴んでいる間の、掴んだ場所と掴んだ時点の設定
let dividing = false; // 境界線を掴んでいるか
let saveTimer = 0;

const stage = $('stage');
const gizmo = $('gizmo');
const divider = $('divider');
const isSplit = () => !!splitOf(cfg);

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

function addStyle(doc, css) {
  const style = doc.createElement('style');
  style.textContent = css;
  doc.head.append(style);
}

const ctl = makeScene(document, stage, false, layout);
addStyle(document, SCENE_CSS);

// 出力を開いているときは、手元のプレビューを基準にしない。聴衆が見るのは出力側で、手元とは縦横比が違うことがある
function currentFitGoal() {
  const onOutput = !!(out && out.scene.W && out.scene.H);
  const sc = onOutput ? out.scene : ctl;
  const goal = fitGoal(cfg, sc.W, sc.H);
  return goal && { ...goal, where: onOutput ? '出力側' : 'プレビュー' };
}

function layout() {
  // スライドショーは聴衆側ディスプレイを全面で覆うので、縦横比をスライドに合わせれば出力と配置が一致する
  const ratio = ctl.slide.videoWidth ? ctl.slide.videoWidth / ctl.slide.videoHeight : 16 / 9;
  stage.style.aspectRatio = ratio;
  // 下の操作パネルが画面外へ押し出されない高さに収める
  stage.style.maxWidth = `min(1100px, ${55 * ratio}vh)`;

  const view = { url, wholePage: showWholePage, adjusting, hasSlide: !!slideStream, anchor: grab?.edge ? grab.start : null };
  const box = layoutScene(ctl, cfg, view);
  if (out) layoutScene(out.scene, cfg, view);

  gizmo.style.display = url ? 'block' : 'none';
  // 掴むための枠は、字幕の枠そのものではなく、画面の中に見えている部分に合わせる。
  // 重ねる配置では枠が画面からはみ出すことがあり、そのまま重ねるとはみ出した側のつまみが掴めなくなる
  const W = stage.clientWidth, H = stage.clientHeight;
  const left = Math.max(box.left, 0), top = Math.max(box.top, 0);
  const right = Math.min(box.left + box.width, W), bottom = Math.min(box.top + box.height, H);
  Object.assign(gizmo.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' });
  // つまみは枠の辺をまたいで置いてあるので、辺が画面の端にあると外側の半分が切れて掴みにくい。端にある辺のつまみは内側へ寄せる
  for (const [side, atEdge] of [['l', left < 1], ['t', top < 1], ['r', right > W - 1], ['b', bottom > H - 1]]) {
    gizmo.classList.toggle('at-' + side, atEdge);
  }
  const sp = splitOf(cfg);
  gizmo.classList.toggle('split', !!sp);
  divider.hidden = !sp;
  if (sp) {
    const at = (sp.subFirst ? cfg.band : 1 - cfg.band) * 100 + '%';
    divider.className = sp.axis === 'x' ? 'v' : 'h';
    divider.style.left = sp.axis === 'x' ? at : '';
    divider.style.top = sp.axis === 'x' ? '' : at;
  }

  // 合わせた結果は、出力を全画面にするなど画面の形が変わると合わなくなる。勝手に合わせ直しはせず、ずれていることだけを出し続ける。
  // ドラッグ中は値が動き続けて下の行まで揺れるうえ、その場では対処もできないので、離したときに更新する
  if (!grab && !dividing) {
    const goal = currentFitGoal();
    $('fitNote').textContent = !goal || goal.fits ? ''
      : `いま${goal.where}の字幕の領域に余白があります(` + (goal.reachable
        ? `窓の高さを ${Math.round(goal.wanted)}px にすると合う)。`
        : `合う高さ ${Math.round(goal.wanted)}px は、指定できる ${Math.round(goal.lo)}〜${goal.hi}px の外)。`);
  }
  $('note').textContent = !url ? '「ソース」に CoeFont の招待URLを貼って読み込む'
    : !slideStream ? 'スライド未選択(聴衆には黒い背景に字幕だけが見える)' : '';
}
new ResizeObserver(layout).observe(stage);

function render() {
  normalize(cfg);
  $('blend').value = cfg.blend;
  $('subOpacity').value = cfg.subOpacity * 100;
  $('oOpacity').textContent = Math.round(cfg.subOpacity * 100) + '%';
  for (const { input, output, key } of WINDOW_SLIDERS) {
    $(input).value = cfg[key];
    $(output).textContent = Math.round(cfg[key]) + 'px';
  }
  const sp = splitOf(cfg);
  $('bandLabel').textContent = sp?.axis === 'x' ? '字幕の領域の幅' : '字幕の領域の高さ';
  $('layoutSel').value = cfg.layout;
  $('band').value = cfg.band * 100;
  $('oBand').textContent = Math.round(cfg.band * 100) + '%';
  for (const id of ['rowBand', 'btnFit']) $(id).hidden = !sp;
  for (const id of ['rowBlend', 'rowOpacity', 'btnResetPos']) $(id).hidden = !!sp;
  $('gizmoLabel').textContent = '字幕(実物は出力側に表示)';
  $('winHint').textContent = sp
    ? 'CoeFont を描く窓の形。幅を狭くするほど文字が大きく映り、高さを増やすほど行数が増える。'
    : 'CoeFont を描く窓の形。文字の大きさは変わらず、枠の形と1行の文字数・行数が変わる(文字の大きさは赤い角で変える)。';
  $('gizmoHint').textContent = sp
    ? 'プレビュー: 赤い線をドラッグでスライドと字幕の境界。字幕の枠の青い辺で切り抜き(境界を動かしても切り抜きは変わらない)。'
    : 'プレビューの字幕の枠: 中をドラッグで移動、赤い角で拡大縮小、青い辺で切り抜き。';
  const fullLabel = showWholePage ? '字幕表示に戻す' : 'CoeFont の画面全体を表示';
  $('btnFull').textContent = '出力側: ' + fullLabel;
  $('btnFull').disabled = !out;
  if (out) out.fullBtn.textContent = fullLabel;
  $('dotSub').classList.toggle('on', !!url);
  $('dotSlide').classList.toggle('on', !!slideStream);
  $('dotOut').classList.toggle('on', !!out);
  $('outState').textContent = out ? '出力ウィンドウ: 表示中' : '出力ウィンドウ: 未表示';
  $('btnOut').textContent = out ? '出力ウィンドウを前面に出す' : '出力ウィンドウを開く';
  $('btnSlide').textContent = slideStream ? '変更' : '選択';
  $('stopSlide').disabled = !slideStream;
  layout();
  scheduleSave();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
}

// ドラッグ中は pointermove のたびに render が走る。そのつど同期的に書き込むと操作が重くなるので、動きが止まってからまとめて保存する
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

function attach(video, s) {
  video.srcObject = s;
  if (s) video.play().catch(() => {});
}

function openOutput() {
  if (out && !out.win.closed) {
    out.win.focus();
    return out;
  }
  const win = window.open('', 'coefont-output', 'popup,width=960,height=540');
  if (!win) {
    setStatus('出力ウィンドウがブロックされました。アドレスバーの表示からこのサイトのポップアップを許可してください。', 'error');
    return null;
  }
  const doc = win.document;
  doc.title = '字幕出力';
  doc.head.innerHTML = '';
  doc.body.innerHTML = '';
  addStyle(doc, SCENE_CSS + OUTPUT_CSS);
  const root = doc.createElement('div');
  root.id = 'root';
  const bar = doc.createElement('div');
  bar.id = 'bar';
  const go = doc.createElement('button');
  go.textContent = '全画面にする';
  const fullBtn = doc.createElement('button');
  fullBtn.className = 'sub';
  bar.append('聴衆側ディスプレイへ移動してから →', go, '(Esc で解除)', fullBtn);
  doc.body.append(root, bar);

  const self = { win, fullBtn, scene: makeScene(doc, root, true, layout) };
  out = self;
  if (url) self.scene.content.src = url;
  attach(self.scene.slide, slideStream);
  go.addEventListener('click', () => {
    // 全体表示のまま聴衆に出してしまわないよう、全画面にするときは字幕表示へ戻す
    showWholePage = false;
    render();
    doc.documentElement.requestFullscreen().catch(() => {});
  });
  fullBtn.addEventListener('click', toggleFull);
  doc.addEventListener('fullscreenchange', () => {
    bar.style.display = doc.fullscreenElement ? 'none' : '';
    layout();
  });
  win.addEventListener('resize', layout);
  win.addEventListener('pagehide', () => {
    if (out !== self) return;
    out = null;
    showWholePage = false;
    render();
    setStatus('出力ウィンドウが閉じられました。「出力ウィンドウを開く」で開き直せます(CoeFont は読み込み直しになります)。', 'warn');
  });
  render();
  return self;
}

// CoeFontはタブ共有で取り込まず、ページそのものを埋め込む。タブ共有を使うと、共有中はChromeが
// 同じプロファイルの全タブ(出力ウィンドウを含む)に「共有しています」バーを出し、ページ側から消せないため
function loadUrl() {
  let u;
  try { u = new URL($('url').value.trim()); } catch {}
  if (!u || u.protocol !== 'https:') {
    setStatus('CoeFont の招待URL(https://〜)を貼ってください。', 'warn');
    return;
  }
  url = u.href;
  try { sessionStorage.setItem(URL_KEY, url); } catch {}
  const o = openOutput();
  if (!o) return;
  o.scene.content.src = url;
  render();
  setStatus('別のウィンドウ(またはタブ)に出力を開きました。そこに CoeFont の画面がそのまま出ているので、開始や設定を済ませてください。そのあと、プレビューの枠の青い辺で字幕以外を切り落とします。\n別のタブでも同じ招待URLを開いていると音声が二重に鳴るので、そちらは閉じてください。');
}

function setSlide(s) {
  if (slideStream) slideStream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  slideStream = s;
  attach(ctl.slide, s);
  if (out) attach(out.scene.slide, s);
  render();
}

async function pickSlide() {
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window', frameRate: { ideal: 30 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      // 画面全体を選ぶと、全画面にした出力ウィンドウ自身が映り込んで合わせ鏡になる
      monitorTypeSurfaces: 'exclude',
    });
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      setStatus('ウィンドウの選択がキャンセル(または拒否)されました。\nmacOSで毎回失敗する場合は、システム設定 > プライバシーとセキュリティ > 画面収録 でブラウザを許可してください。', 'warn');
    } else {
      setStatus(`スライドを取得できませんでした: ${e.name}: ${e.message}`, 'error');
    }
    return;
  }
  setSlide(s);
  const track = s.getVideoTracks()[0];
  track.onended = () => {
    setSlide(null);
    setStatus('スライドの画面共有が終了しました。ソースの「選択」で再接続できます。', 'warn');
  };
  const surface = track.getSettings().displaySurface;
  if (surface === 'browser') {
    setStatus('タブが選ばれています。タブを共有すると Chrome の「共有しています」バーが出力ウィンドウにも出ます。選択画面の「ウィンドウ」からスライドショーを選び直してください。', 'warn');
  } else if (surface === 'monitor') {
    setStatus('画面全体が選ばれています。出力ウィンドウと同じディスプレイだと合わせ鏡になるので、スライドショーの「ウィンドウ」を選び直してください。', 'warn');
  } else {
    setStatus('スライドを取得中。プレビューで字幕の位置を決めてください。');
  }
}

// 離した瞬間には枠線を消さない。出力側で最終的な位置を見届ける間がなくなる
function markAdjusting(holding) {
  adjusting = true;
  clearTimeout(adjustTimer);
  if (!holding) adjustTimer = setTimeout(() => { adjusting = false; layout(); }, 1500);
}

// 窓の形を変えるのは利用者が押したときだけ。切り抜きには触らない
function fitWindow() {
  const goal = currentFitGoal();
  if (!goal) return;
  cfg.fh = goal.wanted;
  markAdjusting(false);
  render();
  const size = `${Math.round(cfg.fw)}×${Math.round(cfg.fh)}px`;
  if (goal.reachable) {
    setStatus(`CoeFont の窓を ${size} にして、${goal.where}の今の画面の形に合わせました。`);
  } else {
    const why = goal.lo > WIN_H_RANGE[0] ? '。下限は切り抜きで残している範囲による' : '';
    setStatus(`合う高さは ${Math.round(goal.wanted)}px ですが、指定できる範囲(${Math.round(goal.lo)}〜${goal.hi}px${why})の外なので、${size} で止めました。窓の幅か、字幕の領域の大きさを変えてからもう一度押してください。`, 'warn');
  }
}

function toggleFull() {
  showWholePage = !showWholePage;
  render();
}

gizmo.addEventListener('pointerdown', (e) => {
  // 並べる配置で掴めるのは切り抜きの辺だけ。枠の中を押しても動かせないので、調整中の扱い(出力側の枠線)にもしない
  if (isSplit() && !e.target.dataset.c) return;
  grab = grabAt(cfg, stage.clientWidth, stage.clientHeight, {
    handle: e.target.dataset.h || '', edge: e.target.dataset.c || '', px: e.clientX, py: e.clientY,
  });
  gizmo.setPointerCapture(e.pointerId);
  e.preventDefault();
  markAdjusting(true);
  layout();
});
gizmo.addEventListener('pointermove', (e) => {
  if (!grab) return;
  const dx = e.clientX - grab.px, dy = e.clientY - grab.py;
  if (grab.edge) dragCrop(cfg, grab, dx, dy);
  else if (grab.handle) dragResize(cfg, grab, dx);
  else dragMove(cfg, grab, dx, dy);
  render();
});
for (const ev of ['pointerup', 'pointercancel']) gizmo.addEventListener(ev, () => {
  if (!grab) return;
  grab = null;
  markAdjusting(false);
  layout();
});

divider.addEventListener('pointerdown', (e) => {
  dividing = true;
  divider.setPointerCapture(e.pointerId);
  e.preventDefault();
  markAdjusting(true);
});
divider.addEventListener('pointermove', (e) => {
  if (!dividing) return;
  const r = stage.getBoundingClientRect();
  dragDivider(cfg, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  render();
});
for (const ev of ['pointerup', 'pointercancel']) divider.addEventListener(ev, () => {
  if (!dividing) return;
  dividing = false;
  markAdjusting(false);
  layout();
});

const actions = {
  loadUrl, pickSlide, openOutput, toggleFull, fitWindow,
  stopSlide: () => { setSlide(null); setStatus('スライドの共有を停止しました。'); },
  resetCrop: () => { Object.assign(cfg, CROP_DEFAULTS); render(); },
  resetWindow: () => { Object.assign(cfg, WINDOW_DEFAULTS); render(); },
  resetPos: () => { Object.assign(cfg, POS_DEFAULTS); render(); },
};
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) actions[act]();
});
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(); });
$('blend').addEventListener('change', (e) => { cfg.blend = e.target.value; render(); });
$('layoutSel').append(...Object.entries(LAYOUTS).map(([value, { label }]) => new Option(label, value)));
$('layoutSel').addEventListener('change', (e) => { cfg.layout = e.target.value; markAdjusting(false); render(); });
$('band').addEventListener('input', (e) => { markAdjusting(false); cfg.band = e.target.value / 100; render(); });
for (const { input, key, range, name } of WINDOW_SLIDERS) {
  [$(input).min, $(input).max] = range;
  $(input).addEventListener('input', (e) => {
    const asked = +e.target.value;
    markAdjusting(false);
    cfg[key] = asked;
    render();
    // 切り抜きを守るために窓が縮まなかったとき、つまみが戻るだけだと故障に見えるので理由を出す
    if (cfg[key] > asked) setStatus(`切り抜きで残している範囲が収まらなくなるため、窓の${name}は ${Math.round(cfg[key])}px より小さくできません。もっと小さくするには、先に切り抜きを減らしてください。`, 'warn');
  });
}
$('subOpacity').addEventListener('input', (e) => { cfg.subOpacity = e.target.value / 100; render(); });
// このタブを閉じると出力ウィンドウを操作できなくなるので道連れにする
window.addEventListener('pagehide', () => {
  save();
  if (out) out.win.close();
});

if (!navigator.mediaDevices?.getDisplayMedia) {
  setStatus(window.isSecureContext
    ? 'このブラウザはスライドの取り込み(画面共有)に対応していません。デスクトップ版の Chrome / Edge を使ってください。'
    : 'このページは HTTPS(または localhost)で開く必要があります。', 'error');
  $('btnSlide').disabled = true;
} else {
  setStatus('① CoeFont の招待URLを読み込む(出力が別ウィンドウかタブで開く) → ② 出力側で CoeFont を開始・設定 → ③ 青い辺で字幕以外を切り落とす → ④ スライドショーのウィンドウを選択 → ⑤ 出力を聴衆側ディスプレイで全画面にする');
}

// 再読み込みで貼り直さずに済むよう、タブを閉じるまでだけURLを覚えておく(招待URLを長く残さない)
try { $('url').value = sessionStorage.getItem(URL_KEY) || ''; } catch {}

// 配信側が10分キャッシュするので、古い版を見ていないか利用者が確かめられるようにする。
// ページの日時だけを出さない。ページとスクリプトは別々にキャッシュされるので、ページだけ新しくてコードが古いことがある。
// 日時が食い違っていても「古い版」とは決めつけない。ファイルごとに更新日時を返す配信元(手元のサーバーなど)では、
// 正常でも食い違う。いま読み込まれているもの(force-cache)の日時の幅をそのまま出すにとどめる
const PARTS = [document.lastModified, ...['./main.js', './model.js', './scene.js'].map((f) => fetch(new URL(f, import.meta.url), { cache: 'force-cache' })
  .then((r) => r.headers.get('last-modified')))];
Promise.allSettled(PARTS).then((results) => {
  const times = results.map((r) => Date.parse(r.value)).filter(Number.isFinite);
  const [oldest, newest] = [Math.min(...times), Math.max(...times)].map((t) => new Date(t).toLocaleString());
  $('build').textContent = '配信日時: ' + (!times.length ? '不明' : oldest === newest ? oldest : `${oldest} 〜 ${newest}`);
});

render();
