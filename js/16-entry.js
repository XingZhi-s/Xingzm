// 依赖：02-core.js, 03-data.js
// 进站动画 / 进站声明 / 锁屏（纯本地，数据只存 IndexedDB）
import { $, dbGet, dbPut, inputDialog, toast } from './02-core.js';

const NOTICE_KEY = 'entry_agreed_v1';
const LOCK_KEY = 'lock_v1';
const AGREEMENT_WORD = '我已阅读';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/* ============ 本地数据 ============ */
async function getNoticeAgreed() {
  try {
    const r = await dbGet('meta', NOTICE_KEY);
    return !!(r && r.agreed);
  } catch (e) { return false; }
}
async function saveNoticeAgreed() {
  await dbPut('meta', { k: NOTICE_KEY, agreed: true, at: Date.now() });
}

export async function getLockSettings() {
  let r = null;
  try { r = await dbGet('meta', LOCK_KEY); } catch (e) { r = null; }
  return { enabled: !!(r && r.enabled), code: (r && String(r.code || '')) || '' };
}
async function saveLockSettings(s) {
  await dbPut('meta', {
    k: LOCK_KEY,
    enabled: !!s.enabled,
    code: String(s.code || ''),
    at: Date.now(),
  });
}

/* ============ 锁屏设置（me 页） ============ */
export async function refreshLockSettingUI() {
  const sw = $('lock-enabled-switch');
  const st = $('lock-code-status');
  if (!sw && !st) return;
  const s = await getLockSettings();
  const hasCode = /^\d{4,8}$/.test(s.code);
  if (sw) sw.classList.toggle('on', !!s.enabled && hasCode);
  if (st) st.textContent = hasCode ? '已设置，点击修改' : '未设置';
}

export async function setLockCode() {
  const s = await getLockSettings();
  const r = await inputDialog('设置数字密码', [
    { key: 'code', label: '数字密码（4-8 位数字）', type: 'password', placeholder: '请输入 4-8 位数字', required: true },
    { key: 'code2', label: '再次输入确认', type: 'password', placeholder: '再次输入数字密码', required: true },
  ], '保存');
  if (!r) return false;
  const code = String(r.code || '').trim();
  if (!/^\d{4,8}$/.test(code)) { toast('密码需为 4-8 位数字'); return false; }
  if (code !== String(r.code2 || '').trim()) { toast('两次输入的密码不一致'); return false; }
  await saveLockSettings({ enabled: s.enabled, code });
  toast('数字密码已保存');
  refreshLockSettingUI();
  return true;
}

export async function toggleLockEnabled() {
  const s = await getLockSettings();
  if (!s.enabled) {
    if (!/^\d{4,8}$/.test(s.code)) {
      const ok = await setLockCode();
      if (!ok) return;
    }
    const latest = await getLockSettings();
    await saveLockSettings({ enabled: true, code: latest.code });
    toast('锁屏已开启');
  } else {
    await saveLockSettings({ enabled: false, code: s.code });
    toast('锁屏已关闭');
  }
  refreshLockSettingUI();
}

/* ============ 进站动画 ============ */
function animateProgress(duration) {
  return new Promise(resolve => {
    const fill = $('entry-progress-fill');
    const pct = $('entry-percent');
    const sub = $('entry-sub');
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const n = Math.round(eased * 100);
      if (fill) fill.style.width = n + '%';
      if (pct) pct.textContent = n + '%';
      if (sub) sub.textContent = n < 42 ? '正在开启星门' : n < 82 ? '正在校准星轨' : '即将抵达';
      if (p < 1) requestAnimationFrame(tick);
      else setTimeout(resolve, 320);
    };
    requestAnimationFrame(tick);
  });
}

function hideEntryMain() {
  const main = $('entry-main');
  if (!main || main.classList.contains('hide')) return;
  main.classList.add('entry-fade-out');
  setTimeout(() => main.classList.add('hide'), 260);
}

function showPanel(id) {
  const panel = $(id);
  if (!panel) return null;
  panel.classList.remove('hide', 'entry-panel-out');
  requestAnimationFrame(() => panel.classList.add('entry-panel-in'));
  return panel;
}

/* ============ 进站声明 ============ */
function showStatement() {
  return new Promise(resolve => {
    const input = $('entry-agree-input');
    const btn = $('entry-agree-btn');
    const err = $('entry-agree-error');
    input.value = '';
    btn.disabled = true;
    err.textContent = '';
    hideEntryMain();
    setTimeout(() => {
      showPanel('entry-statement-panel');
      setTimeout(() => input.focus(), 120);
    }, 280);

    const check = () => {
      btn.disabled = input.value.trim() !== AGREEMENT_WORD;
      err.textContent = '';
    };
    const submit = () => {
      if (btn.disabled || input.value.trim() !== AGREEMENT_WORD) return;
      btn.disabled = true;
      saveNoticeAgreed().then(() => {
        const panel = $('entry-statement-panel');
        panel.classList.add('entry-panel-out');
        setTimeout(() => {
          panel.classList.add('hide');
          resolve();
        }, 260);
      }).catch(() => {
        btn.disabled = false;
        err.textContent = '保存失败，请重试';
      });
    };
    input.oninput = check;
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !btn.disabled) { e.preventDefault(); submit(); }
    };
    btn.onclick = submit;
  });
}

/* ============ 锁屏 ============ */
let _lockCode = '';
let _lockEntry = '';
let _lockChecking = false;
let _lockResolve = null;
let _lockKeyBound = false;

function renderLockDots() {
  const dots = $('entry-lock-dots');
  if (!dots) return;
  let html = '';
  for (let i = 0; i < _lockCode.length; i++) {
    html += `<span class="entry-lock-dot${i < _lockEntry.length ? ' filled' : ''}"></span>`;
  }
  dots.innerHTML = html;
}

function lockPushDigit(d) {
  if (_lockChecking || !_lockCode) return;
  if (_lockEntry.length >= _lockCode.length) return;
  _lockEntry += d;
  const err = $('entry-lock-error');
  if (err) err.textContent = '';
  renderLockDots();
  if (_lockEntry.length === _lockCode.length) {
    _lockChecking = true;
    setTimeout(checkLock, 180);
  }
}
function lockBackspace() {
  if (_lockChecking) return;
  _lockEntry = _lockEntry.slice(0, -1);
  renderLockDots();
}
function lockClear() {
  if (_lockChecking) return;
  _lockEntry = '';
  renderLockDots();
}
function checkLock() {
  const panel = $('entry-lock-panel');
  const err = $('entry-lock-error');
  if (_lockEntry === _lockCode) {
    document.removeEventListener('keydown', onLockPhysicalKey);
    panel.classList.add('entry-panel-out');
    setTimeout(() => {
      panel.classList.add('hide');
      toast('已解锁');
      const done = _lockResolve;
      _lockResolve = null;
      if (done) done();
    }, 260);
  } else {
    _lockChecking = false;
    _lockEntry = '';
    renderLockDots();
    if (err) err.textContent = '密码错误，请重试';
    panel.classList.remove('entry-shake');
    void panel.offsetWidth;
    panel.classList.add('entry-shake');
  }
}
function onLockPhysicalKey(e) {
  const panel = $('entry-lock-panel');
  if (!panel || panel.classList.contains('hide')) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); lockPushDigit(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); lockBackspace(); }
  else if (e.key === 'Escape') { e.preventDefault(); lockClear(); }
}
function bindLockKeypad() {
  if (_lockKeyBound) return;
  _lockKeyBound = true;
  const pad = $('entry-keypad');
  if (!pad) return;
  pad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const k = btn.dataset.key;
    if (k === 'clear') return lockClear();
    if (k === 'back') return lockBackspace();
    lockPushDigit(k);
  });
}

function showLock(code) {
  return new Promise(resolve => {
    _lockCode = String(code);
    _lockEntry = '';
    _lockChecking = false;
    _lockResolve = resolve;
    const err = $('entry-lock-error');
    if (err) err.textContent = '';
    renderLockDots();
    hideEntryMain();
    bindLockKeypad();
    document.addEventListener('keydown', onLockPhysicalKey);
    setTimeout(() => showPanel('entry-lock-panel'), 280);
  });
}

/* ============ 进站总流程 ============ */
export async function bootEntry() {
  const screen = $('entry-screen');
  if (!screen) return;
  requestAnimationFrame(() => screen.classList.add('entry-active'));
  await delay(120);
  await animateProgress(2300);
  if (!await getNoticeAgreed()) await showStatement();
  const lock = await getLockSettings();
  if (lock.enabled && /^\d{4,8}$/.test(lock.code)) await showLock(lock.code);
  screen.classList.add('entry-leave');
  await delay(560);
  screen.remove();
}

// 初始化异常时的兜底：直接收起进站层，避免用户卡在遮罩里
export function forceHideEntryScreen() {
  const screen = $('entry-screen');
  if (!screen) return;
  screen.classList.add('entry-leave');
  setTimeout(() => screen.remove(), 560);
}

// 内联事件
window.toggleLockEnabled = toggleLockEnabled;
window.setLockCode = setLockCode;
