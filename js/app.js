import { Auth } from './auth.js';
import { DB } from './db.js';
import { generatePixPayload, sanitizeChave } from './pix.js';

const wsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.17-.478 1.338-.94.166-.463.166-.86.117-.94-.049-.08-.182-.133-.38-.232z"/></svg>`;

/* =====================================================
   UTILITÁRIOS
===================================================== */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtDate = d => {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};
const fmtLong = d => {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const dayMonth = d => {
  if (!d) return { day: '', mon: '' };
  const [, m, dd] = d.split('-');
  const M = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return { day: dd, mon: M[+m - 1] };
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const svcIcon = name => {
  const n = (name || '').toLowerCase();
  if (n.includes('barba')) return '🪒';
  if (n.includes('limpeza')) return '✨';
  if (n.includes('massagem')) return '💆‍♀️';
  if (n.includes('sobrancelha') || n.includes('facial')) return '🌸';
  if (n.includes('pigment') || n.includes('color')) return '🎨';
  return '💈';
};
const initials = name => (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const AV_COLORS = ['#C9A227', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444'];
const avColor = name => {
  let h = 0;
  for (let c of (name || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
};
const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* =====================================================
   TOAST
===================================================== */
const T = {
  show(msg, type = 's') {
    const icons = { s: '✓', e: '✕', w: '⚠', i: 'ℹ' };
    const w = document.getElementById('toastWrap');
    if (!w) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="ticon">${icons[type] || 'ℹ'}</span><span class="tmsg">${esc(msg)}</span>`;
    w.appendChild(el);
    setTimeout(() => {
      el.style.cssText = 'transition:.3s ease;opacity:0;transform:translateX(100%)';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  },
  ok(m) { this.show(m, 's') }, err(m) { this.show(m, 'e') },
  warn(m) { this.show(m, 'w') }, info(m) { this.show(m, 'i') }
};

/* =====================================================
   DISPONIBILIDADE
===================================================== */
const Avail = {
  slots(proId, date) {
    const pro = DB.pros().find(p => p.id === proId);
    if (!pro) return [];
    const dow = new Date(date + 'T12:00:00').getDay();
    if (!pro.workingDays.includes(dow)) return [];
    const [sh, sm] = pro.workingHours.start.split(':').map(Number);
    const [eh, em] = pro.workingHours.end.split(':').map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em, out = [];
    for (let m = s; m < e; m += 30) {
      const h = Math.floor(m / 60), mn = m % 60;
      out.push(`${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`);
    }
    return out;
  },
  canBook(proId, date, time, dur, skipId = null) {
    const [h, m] = time.split(':').map(Number);
    const s = h * 60 + m, n = Math.ceil(dur / 30);
    const need = new Set();
    for (let i = 0; i < n; i++) { const t = s + i * 30; need.add(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`) }
    const svcs = DB.services();
    return !DB.apts().filter(a => a.professionalId === proId && a.date === date && a.status !== 'cancelado' && a.id !== skipId).some(a => {
      const sv = svcs.find(s => s.id === a.serviceId); if (!sv) return false;
      const [ah, am] = a.time.split(':').map(Number);
      const as2 = ah * 60 + am, an = Math.ceil(sv.duration / 30);
      for (let i = 0; i < an; i++) {
        const t = as2 + i * 30;
        if (need.has(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)) return true;
      }
      return false;
    });
  }
};

/* =====================================================
   BOOKING STATE
===================================================== */
const BS = {
  step: 1, service: null, pro: null, date: null, time: null,
  calM: new Date().getMonth(), calY: new Date().getFullYear(),
  reset() {
    this.step = 1; this.service = null; this.pro = null; this.date = null; this.time = null;
    const d = new Date(); this.calM = d.getMonth(); this.calY = d.getFullYear();
  }
};

/* =====================================================
   ROUTER / NAV
===================================================== */
const Nav = {
  go(page) {
    let base = window.location.href.split('#')[0];
    window.location.href = base + '#' + page;
    App.render();
  }
};
window.Nav = Nav;

let _tenantInfo = null;
let _tenantUsers = [];

/* =====================================================
   RENDER COMPONENTS
===================================================== */
const rNavbar = () => {
  if (!Auth.ok()) return '';
  const hash = window.location.hash.slice(1).split('?')[0];
  const isAdm = Auth.isAdmin();
  const isSuper = Auth.isSuperAdmin();

  let links = [];
  if (isSuper) links = [{ h: 'superadmin', l: 'Super Admin', i: '👑' }];
  else if (isAdm) links = [{ h: 'admin', l: 'Dashboard', i: '◈' }, { h: 'admin-services', l: 'Serviços', i: '✦' }, { h: 'admin-pros', l: 'Profissionais', i: '✨' }, { h: 'admin-appointments', l: 'Agendamentos', i: '📅' }, { h: 'admin-reports', l: 'Relatórios', i: '📊' }, { h: 'admin-pix', l: 'Configurações PIX', i: '⚡' }];
  else links = [{ h: 'home', l: 'Início', i: '⌂' }, { h: 'booking', l: 'Agendar', i: '＋' }, { h: 'appointments', l: 'Meus Agendamentos', i: '📅' }];

  const u = Auth.cur;
  const ac = avColor(u.name);
  const tc = ac === '#C9A227' ? '#000' : '#fff';
  const logoText = _tenantInfo ? _tenantInfo.name : 'Hora Bela';

  return `
<nav class="navbar">
  <div class="nb-inner">
    <div class="nb-logo" onclick="Nav.go('${isSuper ? 'superadmin' : isAdm ? 'admin' : 'home'}')">
      <div class="nb-logo-icon"><img src="img/logo.png" alt="Logo" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"></div>
      <span>${esc(logoText)}</span>
    </div>
    <ul class="nb-nav">
      ${links.map(l => `<li><a href="#${l.h}" class="${hash === l.h ? 'active' : ''}" ${l.h === 'booking' ? 'onclick="App.newBk(); return false;"' : ''}>${l.i} ${l.l}</a></li>`).join('')}
    </ul>
    <div class="nb-right">
      <div class="user-pill" onclick="App.toggleUserDD()" id="uPill">
        <div class="uavatar" style="background:${ac};color:${tc}">${initials(u.name)}</div>
        <span class="uname">${esc(u.name)}</span>
        <span style="color:var(--text2);font-size:.65rem">▼</span>
      </div>
    </div>
    <div class="hamburger" onclick="App.toggleMob()" id="hambBtn">
      <span></span><span></span><span></span>
    </div>
  </div>
</nav>
<div class="mob-menu" id="mobMenu">
  ${links.map(l => `<a href="#${l.h}" class="${hash === l.h ? 'active' : ''}" onclick="${l.h === 'booking' ? 'App.newBk();' : `Nav.go('${l.h}');`} App.closeMob(); return false;">${l.i} ${l.l}</a>`).join('')}
  <div style="height:1px;background:var(--border);margin:8px 0"></div>
  <div style="padding:10px 14px;display:flex;align-items:center;gap:11px">
    <div class="uavatar" style="background:${ac};color:${tc};width:38px;height:38px;font-size:.9rem">${initials(u.name)}</div>
    <div>
      <div style="font-weight:600;font-size:.9rem">${esc(u.name)}</div>
      <div style="font-size:.78rem;color:var(--text2)">${esc(u.email)}</div>
      ${u.points > 0 ? `<div style="font-size:.72rem;color:var(--gold);margin-top:2px">⭐ ${u.points} pontos</div>` : ''}
    </div>
  </div>
  <button class="btn btn-ghost w-full" onclick="App.logout()" style="margin-top:6px">⏻ Sair da conta</button>
</div>`;
};

const rLogin = () => `
<div class="auth-page">
  <div class="auth-card">
    <div style="text-align:center;margin-bottom:28px">
      <div class="auth-logo-wrap"><img src="img/logo.png" alt="Logo" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"></div>
      <span class="auth-logo-text">${esc(_tenantInfo?.name || 'SISTEMA')}</span>
      <span class="auth-logo-sub">Sistema de Agendamentos</span>
    </div>
    <h2 class="auth-title">Bem-vindo de volta</h2>
    <p class="auth-sub">Entre com seus dados para continuar</p>
    <form id="loginF">
      <div class="fg">
        <label class="flabel">E-mail</label>
        <input type="email" name="email" class="fc" placeholder="seu@email.com" required>
      </div>
      <div class="fg">
        <label class="flabel">Senha</label>
        <input type="password" name="pw" class="fc" placeholder="••••••••" required>
      </div>
      <div id="loginErr" class="ferr" style="margin-bottom:12px;display:none"></div>
      <button type="submit" class="btn btn-primary btn-lg w-full" id="btnLogin">Entrar</button>
      <div class="divider" style="color:var(--text3);font-size:.8rem;text-align:center;position:relative;margin:24px 0">
        <span style="background:var(--bg2);padding:0 10px;position:relative;z-index:1;font-weight:600">OU</span>
        <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border);transform:translateY(-50%)"></div>
      </div>
      <button type="button" class="btn btn-ghost btn-lg w-full" style="margin-bottom:18px;gap:10px" onclick="App.loginGoogle()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:20px"> Continuar com Google
      </button>
    </form>
    ${DB.getBarbeariaId() ? `<p class="auth-foot">Não tem conta? <a href="#register" style="font-weight:600">Cadastre-se grátis</a></p>` : ''}
  </div>
</div>`;

const rRegister = () => `
<div class="auth-page">
  <div class="auth-card">
    <div style="text-align:center;margin-bottom:28px">
      <div class="auth-logo-wrap"><img src="img/logo.png" alt="Logo" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"></div>
      <span class="auth-logo-text">${esc(_tenantInfo?.name || 'SISTEMA')}</span>
      <span class="auth-logo-sub">Sistema de Agendamentos</span>
    </div>
    <h2 class="auth-title">Criar conta</h2>
    <p class="auth-sub">Preencha os dados abaixo para se cadastrar</p>
    <form id="regF">
      <div class="fg"><label class="flabel">Nome completo *</label><input type="text" name="name" class="fc" required></div>
      <div class="fg"><label class="flabel">E-mail *</label><input type="email" name="email" class="fc" required></div>
      <div class="fg"><label class="flabel">Telefone</label><input type="tel" name="phone" class="fc"></div>
      <div class="fg"><label class="flabel">Senha * (mín 6 caracteres)</label><input type="password" name="pw" class="fc" required minlength="6"></div>
      <div class="fg"><label class="flabel">Confirmar senha *</label><input type="password" name="pw2" class="fc" required></div>
      <div id="regErr" class="ferr" style="margin-bottom:12px;display:none"></div>
      <button type="submit" class="btn btn-primary btn-lg w-full" id="btnReg">Criar minha conta</button>
      <div class="divider" style="color:var(--text3);font-size:.8rem;text-align:center;position:relative;margin:24px 0">
        <span style="background:var(--bg2);padding:0 10px;position:relative;z-index:1;font-weight:600">OU</span>
        <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border);transform:translateY(-50%)"></div>
      </div>
      <button type="button" class="btn btn-ghost btn-lg w-full" style="margin-bottom:18px;gap:10px" onclick="App.loginGoogle()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:20px"> Continuar com Google
      </button>
    </form>
    <p class="auth-foot">Já tem conta? <a href="#login" style="font-weight:600">Entrar</a></p>
  </div>
</div>`;

const rNoTenant = () => `
<div class="auth-page">
  <div class="auth-card" style="text-align:center">
    <div class="auth-logo-wrap" style="background:var(--bg4);color:var(--text2);box-shadow:none">❓</div>
    <h2 class="auth-title">Clínica não encontrada</h2>
    <p class="auth-sub" style="margin-bottom:0">Por favor, acesse através do link fornecido pela sua clínica. Ex: ?b=nome-da-clinica</p>
    <div style="text-align:center;margin-top:24px">
      <p style="font-size:.8rem;color:var(--text3);margin-bottom:8px">É dono de clínica ou Super Admin?</p>
      <button class="btn btn-ghost btn-sm" onclick="Nav.go('login')">Acessar Painel</button>
    </div>
  </div>
</div>`;

const rHome = () => {
  const svcs = DB.services(), pros = DB.pros(), u = Auth.cur;
  const upApts = DB.apts().filter(a => a.userId === u.id && a.status === 'confirmado' && a.date >= todayStr()).sort((a, b) => a.date.localeCompare(b.date));
  const next = upApts[0];
  return `
<div class="page">
  <div class="container">
    <section class="hero">
      <span class="slabel">✦ Bem-vindo, ${esc(u.name.split(' ')[0])}</span>
      <h1>Seu estilo,<br><span>seu horário.</span></h1>
      <p>Agende agora na ${esc(_tenantInfo?.name || 'clínica')}. Rápido, fácil e sem espera.</p>
      <div class="hero-btns">
        <button class="btn btn-primary btn-lg" onclick="App.newBk()">✦ Agendar Agora</button>
        <button class="btn btn-ghost btn-lg" onclick="Nav.go('appointments')">📅 Meus Agendamentos</button>
      </div>
      ${next ? (() => {
      const sv = svcs.find(s => s.id === next.serviceId); const pr = pros.find(p => p.id === next.professionalId);
      return `<div style="max-width:400px;margin:28px auto 0;background:var(--ga1);border:1px solid var(--gold3);border-radius:var(--r);padding:14px 18px;text-align:left">
          <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:1px;color:var(--gold);font-weight:700;margin-bottom:6px">📅 Próximo Agendamento</div>
          <div style="font-weight:700;font-size:.97rem;font-family:var(--ft)">${esc(sv?.name || '')}</div>
          <div style="font-size:.82rem;color:var(--text2);margin-top:3px">com ${esc(pr?.name || '')} · ${fmtDate(next.date)} às ${next.time}</div>
        </div>`;
    })() : ''}
    </section>
    <div class="gold-line"></div>
    <section>
      <div class="sec-head"><span class="slabel">✦ O que oferecemos</span><h2>Nossos Serviços</h2></div>
      <div class="grid g3">
        ${svcs.map(s => `
        <div class="svc-card" onclick="App.bookWith('${s.id}')">
          <div class="svc-icon">${svcIcon(s.name)}</div>
          <div class="svc-name">${esc(s.name)}</div>
          <div class="svc-meta"><span class="svc-price">${fmt(s.price)}</span><span class="svc-dur">⏱ ${s.duration} min</span></div>
        </div>`).join('')}
      </div>
    </section>
    <div class="gold-line"></div>
    <section style="margin-bottom:60px">
      <div class="sec-head"><span class="slabel">✦ Nossa equipe</span><h2>Nossos Profissionais</h2></div>
      <div class="grid g3">
        ${pros.map(p => {
      const ac = avColor(p.name), tc = ac === '#C9A227' ? '#000' : '#fff';
      return `<div class="brb-card card-hover" onclick="Nav.go('booking')">
            <div class="brb-av" style="background:${ac};color:${tc}">${initials(p.name)}</div>
            <div class="brb-name">${esc(p.name)}</div>
            <div class="tags">${(p.specialties || []).map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
          </div>`;
    }).join('')}
      </div>
    </section>
  </div>
</div>`;
};

// --- BOOKING ---
const rBooking = () => {
  const { step } = BS;
  const stepDefs = ['Serviço', 'Profissional', 'Data & Hora', 'Confirmar'];
  const stepsH = stepDefs.map((lbl, i) => {
    const n = i + 1, act = n === step, done = n < step;
    const cc = done ? 'done' : act ? 'active' : '';
    return `${i > 0 ? `<div class="step-line ${n - 1 < step ? 'done' : ''}"></div>` : ''}<div class="wiz-step"><div class="step-c ${cc}">${done ? '✓' : n}</div><span class="step-lbl ${cc}">${lbl}</span></div>`;
  }).join('');

  if (step === 5) return `<div class="page"><div class="container">${rBkSuccess(_lastPixPayload, BS.service?.price, _lastPixAptId)}</div></div>`;

  const content = step === 1 ? rBkS1() : step === 2 ? rBkS2() : step === 3 ? rBkS3() : rBkS4();
  return `
<div class="page">
  <div class="container">
    <div class="ph"><div><h1 class="ptitle">Novo Agendamento</h1><p class="psub">Siga os passos para reservar seu horário</p></div></div>
    <div class="wiz-steps">${stepsH}</div>
    <div class="card" style="max-width:820px;margin:0 auto">${content}</div>
  </div>
</div>`;
};

const rBkS1 = () => {
  const svcs = DB.services();
  return `
  <h3 style="font-family:var(--ft);font-size:1.15rem;margin-bottom:18px">1. Escolha um serviço</h3>
  <div class="grid g2" style="margin-bottom:22px">
    ${svcs.map(s => `
    <div class="svc-card ${BS.service?.id === s.id ? 'sel' : ''}" onclick="App.selSvc('${s.id}')">
      <div class="svc-icon">${svcIcon(s.name)}</div>
      <div class="svc-name">${esc(s.name)}</div>
      <div class="svc-meta"><span class="svc-price">${fmt(s.price)}</span><span class="svc-dur">⏱ ${s.duration} min</span></div>
    </div>`).join('')}
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!BS.service ? 'disabled' : ''}>Próximo: Profissional →</button>
  </div>`;
};

const rBkS2 = () => {
  const pros = DB.pros();
  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">2. Escolha o profissional</h3></div>
  <div class="grid g3" style="margin-bottom:22px">
    ${pros.map(p => {
    const ac = avColor(p.name), tc = ac === '#C9A227' ? '#000' : '#fff';
    return `<div class="brb-card ${BS.pro?.id === p.id ? 'sel' : ''}" onclick="App.selPro('${p.id}')">
        <div class="brb-av" style="background:${ac};color:${tc}">${initials(p.name)}</div>
        <div class="brb-name">${esc(p.name)}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:10px">🕐 ${p.workingHours.start} – ${p.workingHours.end}</div>
      </div>`;
  }).join('')}
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!BS.pro ? 'disabled' : ''}>Próximo: Data →</button>
  </div>`;
};

const rBkS3 = () => {
  const { calM, calY, date: sd, time: st, pro, service } = BS;
  const mNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const first = new Date(calY, calM, 1).getDay();
  const days = new Date(calY, calM + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let calH = `<div class="cal-wrap"><div class="cal-head"><button class="cal-nav" onclick="App.calP()">‹</button><div class="cal-month">${mNames[calM]} ${calY}</div><button class="cal-nav" onclick="App.calN()">›</button></div><div class="cal-grid">${dows.map(d => `<div class="cal-dow">${d}</div>`).join('')}`;
  for (let i = 0; i < first; i++) calH += `<div class="cal-day om"></div>`;
  for (let d = 1; d <= days; d++) {
    const dObj = new Date(calY, calM, d); dObj.setHours(0, 0, 0, 0);
    const ds = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dis = dObj < today || (pro && !pro.workingDays.includes(dObj.getDay()));
    let cls = 'cal-day' + (dis ? ' dis' : ds === sd ? ' picked' : dObj.getTime() === today.getTime() ? ' today' : '');
    calH += `<div class="${cls}" ${!dis ? `onclick="App.selDate('${ds}')"` : ''}>${d}</div>`;
  }
  calH += `</div></div>`;

  let timesH = '';
  if (sd && pro && service) {
    const allSlots = Avail.slots(pro.id, sd);
    if (allSlots.length === 0) { timesH = `<div style="text-align:center;padding:24px;color:var(--text2)">Profissional não atende neste dia.</div>`; }
    else {
      timesH = `<h4 style="font-size:.8rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Horários — ${fmtDate(sd)}</h4>
      <div class="slots-grid">
        ${allSlots.map(slot => {
        const avail = Avail.canBook(pro.id, sd, slot, service.duration);
        let cls = 'slot' + (!avail ? ' booked' : slot === st ? ' picked' : '');
        return `<div class="${cls}" ${avail ? `onclick="App.selTime('${slot}')"` : ''}>${slot}</div>`;
      }).join('')}
      </div>`;
    }
  }

  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">3. Escolha data e horário</h3></div>
  <div class="booking-date-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:22px">
    <div>${calH}</div>
    <div style="min-height:200px">${timesH || `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:.87rem">Selecione uma data</div>`}</div>
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!sd || !st ? 'disabled' : ''}>Próximo: Confirmar →</button>
  </div>`;
};

const rBkS4 = () => {
  const { service, pro, date, time } = BS; const u = Auth.cur;
  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">4. Confirme seu agendamento</h3></div>
  <div class="conf-sum">
    ${Auth.isAdmin() ? `
    <div class="conf-row" style="border-bottom: 2px solid var(--border2); margin-bottom: 15px; padding-bottom: 15px;">
      <span class="conf-lbl">👤 Selecionar Cliente</span>
      <span class="conf-val">
        <select id="selBkUser" class="fc" style="padding: 4px 8px; font-size: .85rem; width: 200px;">
          <option value="${u.id}">Eu mesmo (${esc(u.name)})</option>
          ${_tenantUsers.filter(usr => usr.id !== u.id).map(usr => `<option value="${usr.id}">${esc(usr.name)} (${esc(usr.email)})</option>`).join('')}
        </select>
      </span>
    </div>` : `<div class="conf-row"><span class="conf-lbl">👤 Cliente</span><span class="conf-val">${esc(u.name)}</span></div>`}
    <div class="conf-row"><span class="conf-lbl">${svcIcon(service.name)} Serviço</span><span class="conf-val">${esc(service.name)}</span></div>
    <div class="conf-row"><span class="conf-lbl">✨ Profissional</span><span class="conf-val">${esc(pro.name)}</span></div>
    <div class="conf-row"><span class="conf-lbl">📅 Data</span><span class="conf-val">${fmtLong(date)}</span></div>
    <div class="conf-row"><span class="conf-lbl">🕐 Horário</span><span class="conf-val">${time}</span></div>
    <div class="conf-row" style="padding-top:14px"><span class="conf-lbl" style="font-size:.87rem;color:var(--text)">💰 Total a pagar</span><span class="conf-val conf-total">${fmt(service.price)}</span></div>
  </div>
  ${_tenantInfo?.pixConfig?.chave ? `
  <div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:var(--r2);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
    <span style="font-size:1.1rem">⚡</span>
    <span style="font-size:.82rem;color:var(--text2)">Após confirmar, você receberá o <strong style="color:var(--warning)">QR Code PIX</strong> para pagamento.</span>
  </div>` : ''}
  <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
    <button class="btn btn-primary btn-lg" id="btnConfirmBk" onclick="App.confirmBk()">✓ Confirmar Agendamento</button>
  </div>`;
};

// Estado do PIX gerado (para reexibir no modal)
let _lastPixPayload = null;
let _lastPixAptId = null;

const rBkSuccess = (pixPayload = null, valor = 0, aptId = null) => {
  const pixCfg = _tenantInfo?.pixConfig;
  const hasPixCfg = !!(pixCfg?.chave);

  let pixSection = '';
  if (hasPixCfg && pixPayload) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pixPayload)}`;
    pixSection = `
    <div class="pix-box" id="pixBox" style="margin:28px auto 0;max-width:460px">
      <div class="pix-box-head">
        <span class="pix-logo">⚡</span>
        <div>
          <div style="font-weight:700;font-size:.97rem">Pague via PIX</div>
          <div style="font-size:.8rem;color:var(--text2)">Escaneie o QR Code ou copie a linha digitável</div>
        </div>
        <div class="pix-valor">${fmt(valor)}</div>
      </div>
      <div class="pix-qr-area">
        <img src="${qrUrl}" alt="QR Code PIX" class="pix-qr-img" onerror="this.style.display='none'">
        <div style="flex:1">
          <div style="font-size:.72rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">Linha Copia e Cola</div>
          <div class="pix-code" id="pixCode" onclick="App.copyPix('${esc(pixPayload)}')">${esc(pixPayload)}</div>
          <button class="btn btn-primary" style="margin-top:10px;width:100%" onclick="App.copyPix('${esc(pixPayload)}')">📋 Copiar código PIX</button>
        </div>
      </div>
      <div style="font-size:.75rem;color:var(--text3);margin-top:12px;text-align:center">Após pagar, o pagamento será confirmado pela equipe.</div>
    </div>`;
  } else if (!hasPixCfg) {
    pixSection = `<p style="color:var(--text2);font-size:.82rem;margin-top:10px">Pagamento presencial — combine com a equipe.</p>`;
  }

  return `
<div class="success-scr ${hasPixCfg ? 'has-pix' : ''}">
  <div class="success-ico">✓</div>
  <h2 style="font-family:var(--ft);font-size:1.75rem;margin-bottom:7px">Agendamento Confirmado!</h2>
  <p style="color:var(--text2);font-size:.9rem">Seu horário está reservado.</p>
  ${pixSection}
  <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;flex-wrap:wrap">
    <button class="btn btn-primary btn-lg" onclick="Nav.go('appointments')">📅 Ver meus agendamentos</button>
  </div>
</div>`;
};

// --- APPOINTMENTS ---
const rAppointments = () => {
  const u = Auth.cur, td = todayStr();
  const svcs = DB.services(), pros = DB.pros();
  const all = DB.apts();
  // Filtra agendamentos do próprio usuário logado
  const upcoming = all.filter(a => a.userId === u.id && a.date >= td && a.status !== 'cancelado').sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter(a => a.userId === u.id && (a.date < td || a.status === 'cancelado')).sort((a, b) => b.date.localeCompare(a.date));

  const rCard = (apt, showAct) => {
    const sv = svcs.find(s => s.id === apt.serviceId), pr = pros.find(p => p.id === apt.professionalId);
    const dm = dayMonth(apt.date);
    const [bc, bl] = apt.status === 'confirmado' ? ['b-success', 'Confirmado'] : apt.status === 'cancelado' ? ['b-danger', 'Cancelado'] : ['b-info', 'Concluído'];
    const isUp = apt.date >= td && apt.status !== 'cancelado';
    // PIX status badge p/ cliente
    const hasPix = !!(_tenantInfo?.pixConfig?.chave);
    let pixInfo = '';
    if (hasPix && apt.pixStatus === 'pendente') {
      pixInfo = `<div style="margin-top:9px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge b-warning" style="font-size:.68rem">⏳ PIX Pendente</span>
        <button class="btn btn-sm" style="background:var(--warning);color:#000;font-size:.72rem;padding:3px 10px" onclick="App.openPixModal('${apt.id}')">Ver QR Code PIX</button>
      </div>`;
    } else if (hasPix && apt.pixStatus === 'pago') {
      pixInfo = `<div style="margin-top:9px"><span class="badge b-success" style="font-size:.68rem">✅ PIX Confirmado</span></div>`;
    }
    return `
    <div class="apt-card">
      <div class="apt-dbox"><div class="apt-day">${dm.day}</div><div class="apt-mon">${dm.mon}</div></div>
      <div style="flex:1;min-width:0">
        <div class="apt-svc">${esc(sv?.name || 'Serviço excluído')}</div>
        <div class="apt-det">✨ ${esc(pr?.name || '—')} · 🕐 ${apt.time}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge ${bc}">${bl}</span>
          <span class="tgold" style="font-weight:700;font-size:.87rem">${fmt(apt.price)}</span>
        </div>
        ${pixInfo}
        ${showAct && isUp ? `
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-danger btn-sm" onclick="App.cancelApt('${apt.id}')">✕ Cancelar</button>
        </div>`: ''}
      </div>
    </div>`;
  };

  return `<div class="page"><div class="container">
    <div class="ph"><div><h1 class="ptitle">Meus Agendamentos</h1></div><button class="btn btn-primary" onclick="Nav.go('booking')">＋ Novo Agendamento</button></div>
    <div class="tabs">
      <div class="tab active" id="tU" onclick="App.tabApt('u')">Próximos (${upcoming.length})</div>
      <div class="tab" id="tH" onclick="App.tabApt('h')">Histórico (${past.length})</div>
    </div>
    <div id="tcU" style="display:flex;flex-direction:column;gap:11px">
      ${upcoming.length === 0 ? `<div class="empty"><div class="empty-ico">📅</div><div class="empty-t">Nenhum agendamento</div></div>` : upcoming.map(a => rCard(a, true)).join('')}
    </div>
    <div id="tcH" style="display:none;flex-direction:column;gap:11px">
      ${past.map(a => rCard(a, false)).join('')}
    </div>
  </div></div>`;
};

/* =====================================================
   ADMIN SCREENS
===================================================== */
const rAdmLayout = (active, content) => {
  const items = [
    { id: 'admin', i: '◈', l: 'Dashboard' },
    { id: 'admin-services', i: '✦', l: 'Serviços' },
    { id: 'admin-barbers', i: '✨', l: 'Profissionais' },
    { id: 'admin-appointments', i: '📅', l: 'Agendamentos' },
    { id: 'admin-reports', i: '📊', l: 'Relatórios' },
    { id: 'admin-pix', i: '⚡', l: 'Configurações PIX' },
  ];
  return `
<div class="adm-layout">
  <div class="adm-mob-nav">
    ${items.map(it => `<button class="btn ${active === it.id ? 'btn-outline' : 'btn-ghost'} btn-sm" onclick="Nav.go('${it.id}')">${it.i}</button>`).join('')}
  </div>
  <aside class="adm-sidebar">
    <div class="adm-st">Painel Clínica</div>
    ${items.map(it => `<a href="#${it.id}" class="adm-nav-item ${active === it.id ? 'active' : ''}" onclick="Nav.go('${it.id}'); return false;">${it.i} <span>${it.l}</span></a>`).join('')}
  </aside>
  <main class="adm-content">${content}</main>
</div>`;
};

const rAdmDash = () => {
  const all = DB.apts(), pros = DB.pros(), svcs = DB.services();
  const td = todayStr();
  const rev = all.filter(a => a.status !== 'cancelado').reduce((s, a) => s + Number(a.price || 0), 0);
  const conf = all.filter(a => a.status === 'confirmado' && a.date >= td);
  const pixPend = all.filter(a => a.pixStatus === 'pendente' && a.status !== 'cancelado');
  const pixOk = all.filter(a => a.pixStatus === 'pago');
  const hasPix = !!(_tenantInfo?.pixConfig?.chave);

  return rAdmLayout('admin', `
  <div class="ph"><div><h1 class="ptitle">Dashboard</h1><p class="psub">${_tenantInfo?.name || ''}</p></div></div>
  <div class="stats-grid">
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Total Agendamentos</span></div><div class="scv">${all.length}</div></div>
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Receita Total</span></div><div class="scv" style="color:var(--success)">${fmt(rev)}</div></div>
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Confirmados Futuros</span></div><div class="scv" style="color:var(--info)">${conf.length}</div></div>
    ${hasPix ? `<div class="stat-card" style="border-color:rgba(245,158,11,.35)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">⚡ PIX Aguardando</span></div><div class="scv" style="color:var(--warning)">${pixPend.length}</div></div>
    <div class="stat-card" style="border-color:rgba(34,197,94,.3)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">✅ PIX Confirmados</span></div><div class="scv" style="color:var(--success)">${pixOk.length}</div></div>` : ''}
  </div>
  ${!hasPix ? `<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:var(--r);padding:14px 18px;display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <span style="font-size:1.4rem">⚡</span>
    <div style="flex:1"><div style="font-weight:600;font-size:.9rem">PIX não configurado</div><div style="font-size:.8rem;color:var(--text2)">Configure sua chave PIX para oferecer pagamento via QR Code aos clientes.</div></div>
    <button class="btn btn-warning btn-sm" onclick="Nav.go('admin-pix')" style="background:var(--warning);color:#000;white-space:nowrap">Configurar agora</button>
  </div>` : ''}`);
};

const rAdmServices = () => {
  const svcs = DB.services();
  return rAdmLayout('admin-services', `
  <div class="ph">
    <div><h1 class="ptitle">Gerenciar Serviços</h1></div>
    <button class="btn btn-primary" onclick="App.openSvcModal()">＋ Novo Serviço</button>
  </div>
  <div class="grid g2">
    ${svcs.map(s => `
    <div class="card card-hover">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:11px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="svc-icon" style="width:38px;height:38px;margin:0;font-size:1.05rem;flex-shrink:0">${svcIcon(s.name)}</div>
          <div><div style="font-weight:700;font-family:var(--ft)">${esc(s.name)}</div><div style="font-size:.75rem;color:var(--text2)">${s.duration} min</div></div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="App.openSvcModal('${s.id}')">✎</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="App.delSvc('${s.id}')">✕</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:11px;border-top:1px solid var(--border)">
        <span class="tgold" style="font-family:var(--ft);font-size:1.2rem;font-weight:700">${fmt(s.price)}</span>
      </div>
    </div>`).join('')}
  </div>`);
};

const rAdmBarbers = () => {
  const pros = DB.pros();
  return rAdmLayout('admin-barbers', `
  <div class="ph">
    <div><h1 class="ptitle">Gerenciar Profissionais</h1></div>
    <button class="btn btn-primary" onclick="App.openBrbModal()">＋ Novo Profissional</button>
  </div>
  <div class="grid g2">
    ${pros.map(p => {
    const ac = avColor(p.name), tc = ac === '#C9A227' ? '#000' : '#fff';
    return `
      <div class="card card-hover">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px">
          <div class="brb-av" style="background:${ac};color:${tc};flex-shrink:0">${initials(p.name)}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:7px">
              <div>
                <div style="font-weight:700;font-family:var(--ft);font-size:1rem">${esc(p.name)}</div>
                <div style="font-size:.75rem;color:var(--text2)">🕐 ${p.workingHours.start} – ${p.workingHours.end}</div>
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="App.openBrbModal('${p.id}')">✎</button>
                <button class="btn btn-danger btn-sm btn-icon" onclick="App.delBrb('${p.id}')">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }).join('')}
  </div>`);
};

const rAdmApts = () => {
  const all = [...DB.apts()].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  const hasPix = !!(_tenantInfo?.pixConfig?.chave);

  const emEspera = all.filter(a => a.status === 'confirmado');
  const concluidos = all.filter(a => a.status === 'concluido');
  const cancelados = all.filter(a => a.status === 'cancelado');

  const renderSection = (title, apts, color, icon) => `
    <div style="margin-bottom: 40px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 18px;">
        <div style="width: 40px; height: 40px; background: ${color}15; border: 1px solid ${color}33; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">${icon}</div>
        <div>
          <h2 style="font-family: var(--ft); font-size: 1.25rem; letter-spacing: 0.5px;">${title}</h2>
          <div style="font-size: 0.75rem; color: var(--text2); font-weight: 600; text-transform: uppercase;">${apts.length} agendamento${apts.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Data</th><th>Hora</th><th>Status</th>${hasPix ? '<th>PIX</th>' : ''}<th>Ações</th>
            </tr>
          </thead>
          <tbody>${rAptRows(apts)}</tbody>
        </table>
      </div>
    </div>
  `;

  return rAdmLayout('admin-appointments', `
    <div class="ph"><div><h1 class="ptitle">Gerenciar Agendamentos</h1><p class="psub">Visualize e controle os horários da sua clínica</p></div></div>
    ${renderSection('Em Espera', emEspera, '#3b82f6', '⏳')}
    ${renderSection('Concluídos', concluidos, '#22c55e', '✅')}
    ${renderSection('Cancelados', cancelados, '#ef4444', '✕')}
  `);
};

const rAptRows = (apts) => {
  if (!apts.length) return `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text2)">Nenhum agendamento encontrado.</td></tr>`;
  const svcs = DB.services(), pros = DB.pros();
  const hasPix = !!(_tenantInfo?.pixConfig?.chave);
  return apts.map(apt => {
    const sv = svcs.find(s => s.id === apt.serviceId), pr = pros.find(p => p.id === apt.professionalId), usr = _tenantUsers.find(u => u.id === apt.userId);
    const [bc, bl] = apt.status === 'confirmado' ? ['b-success', 'Confirmado'] : apt.status === 'cancelado' ? ['b-danger', 'Cancelado'] : ['b-info', 'Concluído'];
    // PIX badge
    let pixBadge = '';
    if (hasPix && apt.pixStatus === 'pago') pixBadge = `<span class="badge b-success" style="font-size:.65rem">✅ PIX Pago</span>`;
    else if (hasPix && apt.pixStatus === 'pendente') pixBadge = `<span class="badge b-warning" style="font-size:.65rem">⏳ Aguardando PIX</span>`;
    else if (hasPix) pixBadge = `<span class="badge b-grey" style="font-size:.65rem">— Sem PIX</span>`;

    const cleanPhone = (usr?.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `https://wa.me/55${cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone}` : null;

    return `<tr>
      <td>${esc(usr?.name || '—')}</td><td>${esc(sv?.name || '—')}</td><td>${esc(pr?.name || '—')}</td>
      <td>${fmtDate(apt.date)}</td><td>${apt.time}</td>
      <td><span class="badge ${bc}">${bl}</span></td>
      ${hasPix ? `<td>${pixBadge}</td>` : ''}
      <td><div style="display:flex;gap:5px;flex-wrap:wrap">
        ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;gap:5px">${wsIcon} Contato</a>` : ''}
        ${apt.status !== 'cancelado' ? `<button class="btn btn-danger btn-sm" onclick="App.admCancel('${apt.id}')">Cancelar</button>` : ''}
        ${apt.status === 'confirmado' ? `<button class="btn btn-success btn-sm" onclick="App.admComplete('${apt.id}')">Concluir</button>` : ''}
        ${hasPix && apt.pixStatus === 'pendente' ? `<button class="btn btn-sm" style="background:var(--warning);color:#000" onclick="App.admMarkPixPaid('${apt.id}')">✓ PIX Pago</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
};

const rAdmPix = () => {
  const pix = _tenantInfo?.pixConfig || {};
  return rAdmLayout('admin-pix', `
  <div class="ph"><div><h1 class="ptitle">Configurações de PIX</h1><p class="psub">Habilite pagamentos instantâneos para seus clientes</p></div></div>
  <div class="card" style="max-width:600px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding:16px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.15);border-radius:var(--r2)">
      <span style="font-size:1.8rem">⚡</span>
      <div>
        <div style="font-weight:700;font-size:1.05rem">PIX Direto</div>
        <div style="font-size:.82rem;color:var(--text2)">O cliente paga via QR Code e você confirma manualmente no painel.</div>
      </div>
    </div>
    <div class="fg"><label class="flabel">Tipo de Chave</label>
      <select class="fc" id="pixTipo">
        <option value="cpf" ${pix.tipo === 'cpf' ? 'selected' : ''}>CPF</option>
        <option value="cnpj" ${pix.tipo === 'cnpj' ? 'selected' : ''}>CNPJ</option>
        <option value="telefone" ${pix.tipo === 'telefone' ? 'selected' : ''}>Celular</option>
        <option value="email" ${pix.tipo === 'email' ? 'selected' : ''}>E-mail</option>
        <option value="aleatoria" ${pix.tipo === 'aleatoria' ? 'selected' : ''}>Chave Aleatória (EVP)</option>
      </select>
    </div>
    <div class="fg"><label class="flabel">Chave PIX</label><input type="text" class="fc" id="pixChave" placeholder="Sua chave aqui..." value="${esc(pix.chave || '')}"></div>
    <div class="grid g2">
      <div class="fg"><label class="flabel">Nome do Beneficiário</label><input type="text" class="fc" id="pixNome" placeholder="Seu nome ou empresa" value="${esc(pix.nome || '')}"></div>
      <div class="fg"><label class="flabel">Cidade</label><input type="text" class="fc" id="pixCidade" placeholder="Sua cidade" value="${esc(pix.cidade || '')}"></div>
    </div>
    <div class="divider"></div>
    <button class="btn btn-primary w-full btn-lg" onclick="App.savePix()">Guardar Configurações</button>
  </div>`);
};

let _reportChart = null;
let _reportFilter = '30'; // dias

const rAdmReports = () => {
  return rAdmLayout('admin-reports', `
  <div class="ph">
    <div><h1 class="ptitle">Relatórios & Métricas</h1><p class="psub">Acompanhe o desempenho da sua clínica</p></div>
    <div class="fca g8">
      <span class="tsm tmuted">Filtrar:</span>
      <select class="fc" style="width:140px;padding:6px 10px" onchange="App.changeReportFilter(this.value)">
        <option value="7" ${_reportFilter === '7' ? 'selected' : ''}>Últimos 7 dias</option>
        <option value="30" ${_reportFilter === '30' ? 'selected' : ''}>Últimos 30 dias</option>
        <option value="90" ${_reportFilter === '90' ? 'selected' : ''}>Últimos 90 dias</option>
      </select>
    </div>
  </div>
  <div class="grid g2">
    <div class="card">
      <h3 style="font-family:var(--ft);font-size:1.1rem;margin-bottom:20px;display:flex;align-items:center;gap:8px">📈 Evolução de Faturamento</h3>
      <div style="height:300px;position:relative"><canvas id="chartRevenue"></canvas></div>
    </div>
    <div class="card">
      <h3 style="font-family:var(--ft);font-size:1.1rem;margin-bottom:20px;display:flex;align-items:center;gap:8px">📊 Agendamentos por Status</h3>
      <div style="height:300px;position:relative"><canvas id="chartStatus"></canvas></div>
    </div>
  </div>
  <div class="stats-grid mt24">
    <div class="stat-card"><div class="scl">Ticket Médio</div><div class="scv" id="statTicket">—</div></div>
    <div class="stat-card"><div class="scl">Total Clientes Atendidos</div><div class="scv" id="statClients">—</div></div>
  </div>`);
};

/* =====================================================
   SUPER ADMIN
===================================================== */
const rSuperAdmin = () => `
<div class="page"><div class="container">
  <div class="ph">
    <div><h1 class="ptitle">Super Admin</h1><p class="psub">Gerenciamento de Clínicas (Tenants)</p></div>
    <button class="btn btn-primary" onclick="App.openTenantModal()">＋ Novo Tenant</button>
  </div>
  <div class="tbl-wrap">
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Clínica</th><th>ID</th><th>Dono</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody id="tbTenants"><tr><td colspan="5" style="text-align:center;padding:40px"><span class="spin"></span></td></tr></tbody>
      </table>
    </div>
  </div>
</div></div>`;

const openTenantModal = () => {
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
    <div class="modal">
      <div class="modal-head"><h3 class="modal-title">Cadastrar Novo Tenant</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
      <form id="tntFrm">
        <div class="fg"><label class="flabel">ID do Tenant (slug sem espaços) *</label><input type="text" name="slug" class="fc" placeholder="minha-clinica" required pattern="[a-z0-9-]+"></div>
        <div class="fg"><label class="flabel">Nome da Clínica *</label><input type="text" name="name" class="fc" required></div>
        <hr style="border-color:var(--border);margin:20px 0">
        <p style="font-size:.8rem;color:var(--text2);margin-bottom:10px">Criar conta de Dono (Admin):</p>
        <div class="fg"><label class="flabel">E-mail do Dono *</label><input type="email" name="demail" class="fc" required></div>
        <div class="fg"><label class="flabel">Senha do Dono *</label><input type="password" name="dpw" class="fc" required minlength="6"></div>
        <button type="submit" class="btn btn-primary w-full" id="btnCTnt">Criar Tenant e Admin</button>
      </form>
    </div>
  </div>`;

  document.getElementById('tntFrm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const slug = fd.get('slug'), name = fd.get('name'), email = fd.get('demail'), pw = fd.get('dpw');
    try {
      document.getElementById('btnCTnt').disabled = true;
      const ex = await DB.getBarbeariaBySlug(slug);
      if (ex) throw new Error('Este slug já está em uso.');

      T.warn('Você será logado como o novo Admin.');
      await Auth.register({ name: 'Dono ' + name, email, pw, role: 'admin', barbeariaId: slug });
      await DB.createBarbearia(slug, name, Auth.cur.id);

      App.closeModal(); T.ok('Tenant criado com sucesso!'); window.location.href = `?b=${slug}#admin`;
    } catch (err) { document.getElementById('btnCTnt').disabled = false; T.err(err.message); }
  };
};

/* =====================================================
   APP CONTROLLER PRINCIPAL
===================================================== */
export const App = {
  async render() {
    const hash = window.location.hash.slice(1).split('?')[0] || 'home';
    const app = document.getElementById('app');
    const dd = document.getElementById('userDD'); if (dd) dd.remove();

    const hasTenant = !!DB.getBarbeariaId();
    if (!hasTenant && hash !== 'superadmin' && hash !== 'login' && hash !== 'register') {
      if (Auth.isSuperAdmin()) { Nav.go('superadmin'); return; }
      else if (Auth.isAdmin() && Auth.cur.barbeariaId) { window.location.href = `?b=${Auth.cur.barbeariaId}#admin`; return; }
      else { app.innerHTML = rNoTenant(); return; }
    }

    if (!Auth.ok() && !['login', 'register'].includes(hash)) { window.location.hash = 'login'; return; }

    if (Auth.ok()) {
      if (['login', 'register'].includes(hash)) { window.location.hash = Auth.isAdmin() ? 'admin' : 'home'; return; }
      if (Auth.isAdmin() && hash === 'home') { window.location.hash = 'admin'; return; }
      if (Auth.isSuperAdmin() && hash !== 'superadmin') { window.location.hash = 'superadmin'; return; }
    }

    app.innerHTML = '<div style="padding:100px;text-align:center;color:var(--gold)">Carregando...</div>';

    let content = '';
    if (hash === 'login') { content = rLogin(); this._draw(app, content); this._bindAuth(); return; }
    if (hash === 'register') { content = rRegister(); this._draw(app, content); this._bindAuth(); return; }
    if (hash === 'superadmin') {
      content = rSuperAdmin(); this._draw(app, rNavbar() + content);
      this._loadTenants(); return;
    }

    if (hasTenant && Auth.ok()) {
      await DB.loadServices();
      await DB.loadPros();
      // Sempre carrega todos os agendamentos para correta verificação de disponibilidade
      await DB.loadApts();
      if (Auth.isAdmin()) { _tenantUsers = await DB.loadTenantUsers(); }
    }

    if (hash === 'home') content = rHome();
    else if (hash === 'booking') {
      if (BS.step === 5) BS.reset(); // Garante que se o usuário já agendou, comece um novo ao voltar
      content = rBooking();
    }
    else if (hash === 'appointments') content = rAppointments();
    else if (hash === 'admin') content = rAdmDash();
    else if (hash === 'admin-services') content = rAdmServices();
    else if (hash === 'admin-barbers') content = rAdmBarbers();
    else if (hash === 'admin-appointments') content = rAdmApts();
    else if (hash === 'admin-reports') { content = rAdmReports(); this._draw(app, rNavbar() + `<div style="flex:1">${content}</div>`); this._drawReportChart(); return; }
    else if (hash === 'admin-pix') content = rAdmPix();
    else content = rHome();

    this._draw(app, rNavbar() + `<div style="flex:1">${content}</div>`);
  },

  _draw(app, html) { app.innerHTML = html; },

  _bindAuth() {
    const lf = document.getElementById('loginF');
    if (lf) lf.onsubmit = async e => {
      e.preventDefault();
      const b = document.getElementById('btnLogin'); b.disabled = true; b.textContent = 'Entrando...';
      const fd = new FormData(e.target), err = document.getElementById('loginErr');
      try {
        const u = await Auth.login(fd.get('email'), fd.get('pw'));
        if (u.role === 'customer' || u.role === 'admin') {
          if (u.barbeariaId !== DB.getBarbeariaId() && DB.getBarbeariaId()) {
            await Auth.logout(); throw new Error('Conta não pertence a esta clínica.');
          }
        }
        T.ok(`Bem-vindo!`); Nav.go(u.role === 'admin' ? 'admin' : u.role === 'superadmin' ? 'superadmin' : 'home');
      }
      catch (ex) { err.textContent = ex.message; err.style.display = 'block'; b.disabled = false; b.textContent = 'Entrar'; }
    };

    const rf = document.getElementById('regF');
    if (rf) rf.onsubmit = async e => {
      e.preventDefault();
      const b = document.getElementById('btnReg'); b.disabled = true; b.textContent = 'Criando...';
      const fd = new FormData(e.target), err = document.getElementById('regErr');
      if (fd.get('pw') !== fd.get('pw2')) { err.textContent = 'As senhas não conferem.'; err.style.display = 'block'; b.disabled = false; b.textContent = 'Criar minha conta'; return; }
      try {
        await Auth.register({ name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), pw: fd.get('pw') });
        T.ok('Cadastro realizado com sucesso!'); Nav.go('home');
      }
      catch (ex) { err.textContent = ex.message; err.style.display = 'block'; b.disabled = false; b.textContent = 'Criar minha conta'; }
    };
  },

  async loginGoogle() {
    const err = document.getElementById('loginErr') || document.getElementById('regErr');
    try {
      const u = await Auth.loginWithGoogle(DB.getBarbeariaId());
      if (u.role === 'customer' || u.role === 'admin') {
        if (u.barbeariaId !== DB.getBarbeariaId() && DB.getBarbeariaId()) {
          await Auth.logout(); throw new Error('Conta não pertence a esta clínica.');
        }
      }
      T.ok(`Bem-vindo, ${u.name}!`); Nav.go(u.role === 'admin' ? 'admin' : u.role === 'superadmin' ? 'superadmin' : 'home');
    } catch (ex) {
      if (err) { err.textContent = ex.message; err.style.display = 'block'; }
      else { T.err(ex.message); }
    }
  },

  async _loadTenants() {
    const list = await DB.getAllBarbearias();
    const tBody = document.getElementById('tbTenants');
    if (!tBody) return;
    tBody.innerHTML = list.map(t => {
      const isAct = t.status === 'active';
      return `<tr>
        <td><strong style="color:var(--gold)">${esc(t.name)}</strong></td>
        <td><code class="tsm">${esc(t.id)}</code></td>
        <td><div class="fc-"><span style="font-weight:600">${esc(t.ownerName || '—')}</span><span class="tsm tmuted">${esc(t.ownerEmail || '—')}</span></div></td>
        <td><span class="badge ${isAct ? 'b-success' : 'b-danger'}">${isAct ? 'Ativo' : 'Inativo'}</span></td>
        <td><div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-sm btn-ghost" onclick="App.openEditTenantModal('${t.id}')" title="Editar">✏️</button>
          <div class="toggle-switch">
            <input type="checkbox" id="tg-${t.id}" ${isAct ? 'checked' : ''} onchange="App.toggleTenant('${t.id}', this.checked)">
            <label for="tg-${t.id}" class="toggle-slider"></label>
          </div>
          ${t.ownerPhone ? `<a href="https://wa.me/55${t.ownerPhone.replace(/\D/g, '')}" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;padding:5px 8px">${wsIcon}</a>` : ''}
          <button class="btn btn-danger btn-sm" onclick="App.deleteTenant('${t.id}')" title="Excluir">✕</button>
        </div></td>
      </tr>`;
    }).join('');
  },

  async toggleTenant(id, isActive) {
    const newStatus = isActive ? 'active' : 'inactive';
    try {
      await DB.updateBarbeariaStatus(id, newStatus);
      T.ok(`Tenant ${isActive ? 'ativado' : 'desativado'}.`);
      this._loadTenants();
    } catch (e) {
      console.error(e);
      T.err('Erro ao atualizar status.');
      this._loadTenants();
    }
  },

  async logout() { await Auth.logout(); T.info('Você saiu.'); window.location.hash = 'login'; this.render(); },

  // Booking Methods
  bookWith(svcId) { BS.reset(); const s = DB.services().find(x => x.id === svcId); if (s) { BS.service = s; BS.step = 2; } Nav.go('booking'); },
  newBk() { BS.reset(); Nav.go('booking'); },
  selSvc(id) { BS.service = DB.services().find(x => x.id === id) || null; this.render(); },
  selPro(id) { BS.pro = DB.pros().find(x => x.id === id) || null; this.render(); },
  selDate(d) { BS.date = d; BS.time = null; this.render(); },
  selTime(t) { BS.time = t; this.render(); },
  calP() { BS.calM--; if (BS.calM < 0) { BS.calM = 11; BS.calY--; } this.render(); },
  calN() { BS.calM++; if (BS.calM > 11) { BS.calM = 0; BS.calY++; } this.render(); },
  bkNext() {
    const { step, service, pro, date, time } = BS;
    if (step === 1 && !service) { T.warn('Selecione um serviço.'); return; }
    if (step === 2 && !pro) { T.warn('Selecione um profissional.'); return; }
    if (step === 3 && (!date || !time)) { T.warn('Selecione data e horário.'); return; }
    BS.step++; this.render();
  },
  bkBack() { BS.step = Math.max(1, BS.step - 1); this.render(); },

  async confirmBk() {
    const { service, pro, date, time } = BS; const u = Auth.cur;
    if (!service || !pro || !date || !time) { T.err('Dados incompletos.'); return; }
    
    // Define para qual cliente o agendamento será feito (se admin, pode escolher outro)
    const selEl = document.getElementById('selBkUser');
    const targetUserId = selEl ? selEl.value : u.id;
    const targetUser = Auth.isAdmin() ? (_tenantUsers.find(x => x.id === targetUserId) || u) : u;

    const btn = document.getElementById('btnConfirmBk');
    btn.disabled = true; btn.textContent = 'Reservando...';
    try {
      if (!Avail.canBook(pro.id, date, time, service.duration)) {
        T.err('Horário indisponível.'); BS.step = 3; this.render(); return;
      }
      const apt = { 
        userId: targetUserId, serviceId: service.id, professionalId: pro.id, 
        date, time, status: 'confirmado', createdAt: new Date().toISOString(), price: service.price 
      };

      // Se o tenant tem PIX configurado, marcamos o status do PIX como pendente
      const pixCfg = _tenantInfo?.pixConfig;
      if (pixCfg?.chave) apt.pixStatus = 'pendente';

      const docRef = await DB.addAptAndReturn(apt);
      _lastPixAptId = docRef.id;

      // Gera Payload PIX se necessário
      if (pixCfg?.chave) {
        _lastPixPayload = generatePixPayload({
          chave: pixCfg.chave,
          nome: pixCfg.nome || _tenantInfo.name,
          cidade: pixCfg.cidade || 'SAO PAULO',
          valor: service.price,
          txId: docRef.id,
          desc: `Agendamento ${service.name}`
        });
      }

      await DB.updateUserPoints(targetUserId, (targetUser.points || 0) + Math.floor(service.price));
      BS.step = 5; T.ok('Agendamento confirmado!'); this.render();
    } catch (e) {
      console.error(e); T.err('Erro ao agendar.'); btn.disabled = false; btn.textContent = '✓ Confirmar Agendamento';
    }
  },

  async cancelApt(id) {
    if (!confirm('Cancelar este agendamento?')) return;
    await DB.updateAptStatus(id, 'cancelado');
    T.ok('Agendamento cancelado.'); this.render();
  },

  tabApt(tab) {
    const u = document.getElementById('tcU'), h = document.getElementById('tcH');
    const tu = document.getElementById('tU'), th = document.getElementById('tH');
    if (tab === 'u') { u.style.display = 'flex'; h.style.display = 'none'; tu.classList.add('active'); th.classList.remove('active'); }
    else { u.style.display = 'none'; h.style.display = 'flex'; tu.classList.remove('active'); th.classList.add('active'); }
  },

  // Admin Methods
  openSvcModal(id = null) {
    const s = id ? DB.services().find(x => x.id === id) : null;
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">${s ? 'Editar Serviço' : 'Novo Serviço'}</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="svcFrm">
          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" value="${esc(s?.name || '')}" required></div>
          <div class="fg"><label class="flabel">Duração (min) *</label><input type="number" name="dur" class="fc" value="${s?.duration || 30}" min="15" step="15" required></div>
          <div class="fg"><label class="flabel">Preço (R$) *</label><input type="number" name="price" class="fc" value="${s?.price || ''}" min="0" step="0.01" required></div>
          <button type="submit" class="btn btn-primary w-full">${s ? 'Salvar' : 'Criar'}</button>
        </form>
      </div>
    </div>`;
    document.getElementById('svcFrm').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target);
      const data = { name: fd.get('name'), duration: +fd.get('dur'), price: +fd.get('price') };
      if (s) data.id = s.id;
      await DB.saveService(data); App.closeModal(); T.ok(s ? 'Atualizado!' : 'Criado!'); this.render();
    };
  },

  openBrbModal(id = null) {
    const p = id ? DB.pros().find(x => x.id === id) : null; const dn = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">${p ? 'Editar Profissional' : 'Novo Profissional'}</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="brbFrm">
          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" value="${esc(p?.name || '')}" required></div>
          <div class="fg"><label class="flabel">Especialidades (separadas por vírgula)</label><input type="text" name="specs" class="fc" value="${esc((p?.specialties || []).join(', '))}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="fg"><label class="flabel">Entrada</label><input type="time" name="start" class="fc" value="${p?.workingHours?.start || '09:00'}"></div>
            <div class="fg"><label class="flabel">Saída</label><input type="time" name="end" class="fc" value="${p?.workingHours?.end || '18:00'}"></div>
          </div>
          <div class="fg"><label class="flabel">Dias de trabalho</label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:5px">
              ${dn.map((d, i) => `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;font-size:.82rem"><input type="checkbox" name="wd" value="${i}" ${(p?.workingDays || [1, 2, 3, 4, 5]).includes(i) ? 'checked' : ''}>${d}</label>`).join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full">${p ? 'Salvar' : 'Cadastrar'}</button>
        </form>
      </div>
    </div>`;
    document.getElementById('brbFrm').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target);
      const wds = Array.from(e.target.querySelectorAll('input[name="wd"]:checked')).map(el => +el.value);
      const data = { name: fd.get('name'), specialties: fd.get('specs').split(',').map(s => s.trim()).filter(Boolean), workingHours: { start: fd.get('start'), end: fd.get('end') }, workingDays: wds };
      if (p) data.id = p.id;
      await DB.savePro(data); App.closeModal(); T.ok(p ? 'Atualizado!' : 'Cadastrado!'); this.render();
    };
  },

  async delSvc(id) { if (confirm('Excluir este serviço?')) { await DB.deleteService(id); T.ok('Serviço excluído.'); this.render(); } },
  async delBrb(id) { if (confirm('Excluir este profissional?')) { await DB.deletePro(id); T.ok('Profissional excluído.'); this.render(); } },
  async admCancel(id) { if (confirm('Cancelar agendamento?')) { await DB.updateAptStatus(id, 'cancelado'); T.ok('Cancelado.'); this.render(); } },
  async admComplete(id) { await DB.updateAptStatus(id, 'concluido'); T.ok('Concluído.'); this.render(); },
  async admMarkPixPaid(id) {
    if (!confirm('Confirmar recebimento deste PIX?')) return;
    await DB.updateAptPixStatus(id, 'pago');
    T.ok('Pagamento confirmado!'); this.render();
  },

  async openPixModal(aptId) {
    const apt = DB.apts().find(a => a.id === aptId);
    if (!apt) return;
    const sv = DB.services().find(s => s.id === apt.serviceId);
    const pixCfg = _tenantInfo.pixConfig;

    const payload = generatePixPayload({
      chave: pixCfg.chave,
      nome: pixCfg.nome || _tenantInfo.name,
      cidade: pixCfg.cidade || 'SAO PAULO',
      valor: apt.price,
      txId: apt.id,
      desc: `Agendamento ${sv?.name || ''}`
    });

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload)}`;

    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="text-align:center">
        <div class="modal-head"><h3 class="modal-title">Pagamento via PIX</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <div class="pix-box">
          <div class="pix-box-head">
            <span class="pix-logo">⚡</span>
            <div style="text-align:left">
              <div style="font-weight:700">Pague via PIX</div>
              <div style="font-size:.75rem;color:var(--text2)">Escaneie ou copie o código</div>
            </div>
            <div class="pix-valor">${fmt(apt.price)}</div>
          </div>
          <div style="padding:20px">
            <img src="${qrUrl}" style="width:200px;height:200px;border-radius:12px;border:1px solid var(--border);margin-bottom:15px">
            <div class="pix-code" onclick="App.copyPix('${esc(payload)}')">${esc(payload)}</div>
            <button class="btn btn-primary w-full" style="margin-top:15px" onclick="App.copyPix('${esc(payload)}')">📋 Copiar código PIX</button>
          </div>
        </div>
        <p style="font-size:.8rem;color:var(--text2);margin-top:15px">Após o pagamento, aguarde a confirmação manual.</p>
      </div>
    </div>`;
  },

  copyPix(payload) {
    navigator.clipboard.writeText(payload);
    T.ok('Código PIX copiado!');
  },

  async savePix() {
    const chave = document.getElementById('pixChave').value;
    const tipo = document.getElementById('pixTipo').value;
    const nome = document.getElementById('pixNome').value;
    const cidade = document.getElementById('pixCidade').value;

    if (!chave || !nome || !cidade) { T.warn('Preencha todos os campos.'); return; }

    const config = { tipo, chave: sanitizeChave(tipo, chave), nome, cidade };
    await DB.saveBarbeariaPixConfig(DB.getBarbeariaId(), config);
    _tenantInfo = await DB.refreshTenantInfo(DB.getBarbeariaId());
    T.ok('Configurações PIX salvas!');
    this.render();
  },

  changeReportFilter(val) {
    _reportFilter = val;
    this.render();
  },

  async _drawReportChart() {
    const days = parseInt(_reportFilter);
    const apts = DB.apts().filter(a => {
      const diff = (new Date() - new Date(a.date)) / (1000 * 60 * 60 * 24);
      return diff <= days;
    });

    const revenueByDay = {};
    const statusCounts = { confirmado: 0, concluido: 0, cancelado: 0 };

    apts.forEach(a => {
      if (a.status !== 'cancelado') revenueByDay[a.date] = (revenueByDay[a.date] || 0) + Number(a.price || 0);
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    });

    const sortedDays = Object.keys(revenueByDay).sort();
    const revData = sortedDays.map(d => revenueByDay[d]);
    const labels = sortedDays.map(d => fmtDate(d));

    const totalRev = apts.filter(a => a.status !== 'cancelado').reduce((s, a) => s + Number(a.price || 0), 0);
    const atendidos = apts.filter(a => a.status === 'concluido').length;
    document.getElementById('statTicket').textContent = fmt(atendidos ? totalRev / atendidos : 0);
    document.getElementById('statClients').textContent = atendidos;

    if (window.Chart) {
      new Chart(document.getElementById('chartRevenue'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Receita (R$)', data: revData, borderColor: '#D98A94', backgroundColor: 'rgba(217, 138, 148, 0.1)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      new Chart(document.getElementById('chartStatus'), {
        type: 'doughnut',
        data: { labels: ['Pendente', 'Concluído', 'Cancelado'], datasets: [{ data: [statusCounts.confirmado, statusCounts.concluido, statusCounts.cancelado], backgroundColor: ['#3b82f6', '#22c55e', '#ef4444'] }] },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  },

  async openEditTenantModal(slug) {
    const t = await DB.getBarbeariaBySlug(slug);
    const owner = t.donoId ? await DB.getUserById(t.donoId) : null;

    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">Editar Clínica</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="editTntFrm">
          <div class="fg"><label class="flabel">Nome da Clínica *</label><input type="text" name="name" class="fc" value="${esc(t.name)}" required></div>
          <hr style="margin:20px 0; border-color:var(--border)">
          <p style="font-size:.8rem;color:var(--text2);margin-bottom:10px">Dados do Proprietário:</p>
          <div class="fg"><label class="flabel">Nome do Dono</label><input type="text" name="ownerName" class="fc" value="${esc(owner?.name || '')}"></div>
          <div class="fg"><label class="flabel">E-mail (apenas visualização)</label><input type="text" class="fc" value="${esc(owner?.email || '')}" disabled></div>
          <div class="fg"><label class="flabel">Telefone</label><input type="text" name="ownerPhone" class="fc" value="${esc(owner?.phone || '')}" placeholder="Ex: 11999999999"></div>
          
          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="btn btn-primary flex-1">Salvar Alterações</button>
            <button type="button" class="btn btn-ghost" onclick="App.sendPasswordReset('${owner?.email}')">Resetar Senha</button>
          </div>
        </form>
      </div>
    </div>`;

    document.getElementById('editTntFrm').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await DB.updateBarbeariaData(slug, { name: fd.get('name'), ownerName: fd.get('ownerName'), ownerPhone: fd.get('ownerPhone') });
        if (owner) await DB.updateUserProfile(owner.id, { name: fd.get('ownerName'), phone: fd.get('ownerPhone') });
        T.ok('Dados atualizados!');
        App.closeModal();
        this._loadTenants();
      } catch (err) { T.err(err.message); }
    };
  },

  async sendPasswordReset(email) {
    if (!email || email === 'undefined') return T.err('E-mail não encontrado.');
    if (!confirm(`Enviar link de recuperação de senha para ${email}?`)) return;
    try {
      await DB.sendOwnerPasswordReset(email);
      T.ok('E-mail de recuperação enviado!');
    } catch (err) { T.err(err.message); }
  },

  async deleteTenant(slug) {
    if (!confirm(`TEM CERTEZA? Isso excluirá permanentemente a clínica "${slug}".`)) return;
    if (!confirm(`CONFIRMAÇÃO FINAL: Todos os dados serão perdidos. Continuar?`)) return;
    try {
      await DB.deleteBarbearia(slug);
      T.ok('Clínica excluída com sucesso.');
      this._loadTenants();
    } catch (err) { T.err(err.message); }
  },


  toggleUserDD() {
    const existing = document.getElementById('userDD'); if (existing) { existing.remove(); return; }
    const u = Auth.cur; const ac = avColor(u.name); const tc = ac === '#C9A227' ? '#000' : '#fff';
    document.body.insertAdjacentHTML('beforeend', `
    <div id="userDD" style="position:fixed;top:62px;right:18px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:7px;min-width:195px;box-shadow:var(--sh);z-index:1100;animation:slideUp .15s ease">
      <div style="padding:9px 11px;border-bottom:1px solid var(--border);margin-bottom:4px"><div style="font-weight:700;font-size:.88rem">${esc(u.name)}</div><div style="font-size:.78rem;color:var(--text2)">${esc(u.email)}</div></div>
      <button class="btn btn-ghost w-full" style="justify-content:flex-start;gap:9px;padding:7px 11px;font-size:.85rem" onclick="App.logout()">⏻ Sair da conta</button>
    </div>`);
    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!e.target.closest('#userDD') && !e.target.closest('#uPill')) { const dd = document.getElementById('userDD'); if (dd) dd.remove(); document.removeEventListener('click', h); }
      });
    }, 0);
  },
  toggleMob() { const m = document.getElementById('mobMenu'); if (m) m.classList.toggle('open'); },
  closeMob() { const m = document.getElementById('mobMenu'); if (m) m.classList.remove('open'); },
  closeModal() { document.getElementById('modalRoot').innerHTML = ''; },
  openTenantModal() { openTenantModal(); },

  // Init
  async init() {
    window.App = this;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('b');

    if (tenantId) {
      DB.setBarbeariaId(tenantId);
      _tenantInfo = await DB.getBarbeariaBySlug(tenantId);
      if (!_tenantInfo || _tenantInfo.status !== 'active') { document.getElementById('app').innerHTML = rNoTenant(); return; }
    }

    Auth.init((user) => { this.render(); });
    window.addEventListener('hashchange', () => this.render());
  }
};

App.init();
