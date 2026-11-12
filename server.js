// Quiz NBC 540 e 550 - servidor sem dependências (apenas Node 18+)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_PLAYERS = 25;
const ALLIN_CHANCE = 0.35; // chance de quem acertou primeiro cair no "tudo ou nada"
const DATA = path.join(__dirname, 'data.json');

let questions = [];
try { questions = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
const saveQuestions = () => { try { fs.writeFileSync(DATA, JSON.stringify(questions)); } catch (e) {} };

const COLORS = ['#ff5d8f', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff9f43', '#7bed9f', '#ff6b6b', '#70a1ff', '#e2a8ff'];
const players = new Map();
const clients = new Set();
let bubbles = {};
let g = { phase: 'lobby', q: -1, endsAt: 0, answers: [], timer: null, firstId: null, powerUsed: false };

function view() {
  const q = questions[g.q];
  return {
    phase: g.phase, q: g.q, total: questions.length, endsAt: g.endsAt, now: Date.now(), max: MAX_PLAYERS,
    question: q && g.phase !== 'lobby' ? {
      text: q.text, options: q.options, time: q.time, points: q.points,
      correct: g.phase === 'reveal' || g.phase === 'ended' ? q.correct : undefined
    } : null,
    powerFor: g.phase === 'reveal' && g.firstId && !g.powerUsed ? g.firstId : null,
    firstId: g.phase === 'reveal' ? g.firstId : null,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, points: p.points, blocked: p.blocked, allin: p.allin,
      online: p.online, answered: g.answers.some(a => a.id === p.id)
    })),
    bubbles
  };
}
function broadcast() {
  const data = 'data: ' + JSON.stringify(view()) + '\n\n';
  for (const c of clients) c.res.write(data);
}
function bubble(id, text) {
  const ts = Date.now();
  bubbles[id] = { text, ts };
  setTimeout(() => { if (bubbles[id] && bubbles[id].ts === ts) { delete bubbles[id]; broadcast(); } }, 9000);
}

function startQuestion() {
  g.q++; g.phase = 'question'; g.answers = []; g.firstId = null; g.powerUsed = false;
  const q = questions[g.q];
  g.endsAt = Date.now() + q.time * 1000;
  clearTimeout(g.timer);
  g.timer = setTimeout(closeQuestion, q.time * 1000 + 300);
  broadcast();
}

function closeQuestion() {
  if (g.phase !== 'question') return;
  clearTimeout(g.timer);
  g.phase = 'reveal';
  const q = questions[g.q], total = q.time * 1000;
  let first = null;
  for (const p of players.values()) {
    const a = g.answers.find(x => x.id === p.id);
    const ok = !!a && a.choice === q.correct && !p.blocked;
    if (ok) {
      const left = Math.max(0, g.endsAt - a.t);
      p.points += q.points + Math.round(q.points * 0.5 * left / total);
      if (!first || a.t < first.t) first = a;
    }
    if (p.allin) {
      if (p.blocked) { /* bloqueado não perde nada */ }
      else if (ok) { p.points *= 2; bubble(p.id, '💥 TUDO OU NADO: pontos dobrados!'); }
      else { p.points = 0; bubble(p.id, '💀 TUDO OU NADO: perdeu todos os pontos!'); }
      p.allin = false;
    }
    p.blocked = false;
  }
  if (first) {
    g.firstId = first.id;
    const p = players.get(first.id);
    let text = '⚡ Acertou primeiro e ganhou um poder!';
    if (g.q < questions.length - 1 && Math.random() < ALLIN_CHANCE) {
      p.allin = true;
      text += ' 🎲 Caiu no TUDO OU NADO!';
    }
    bubble(first.id, text);
  }
  broadcast();
}

function applyPower(me, target, power) {
  let mine, theirs;
  if (power === 'block') {
    target.blocked = true;
    mine = `🚫 ${me.name} bloqueou ${target.name}`; theirs = `🚫 ${me.name} bloqueou ${target.name}`;
  } else if (power === 'zero') {
    target.points = 0;
    mine = `💣 ${me.name} zerou os pontos de ${target.name}`; theirs = mine;
  } else {
    const s = Math.floor(target.points / 2);
    target.points -= s; me.points += s;
    mine = `🥷 ${me.name} roubou ${s} pts de ${target.name}`; theirs = mine;
  }
  bubble(me.id, mine); bubble(target.id, theirs);
}

function resetGame(removePlayers) {
  clearTimeout(g.timer);
  g = { phase: 'lobby', q: -1, endsAt: 0, answers: [], timer: null, firstId: null, powerUsed: false };
  bubbles = {};
  if (removePlayers) players.clear();
  else for (const p of players.values()) { p.points = 0; p.blocked = false; p.allin = false; }
  broadcast();
}

function validQuestions(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const q of arr) {
    const options = (q.options || []).map(o => String(o).trim().slice(0, 200)).filter(Boolean);
    const text = String(q.text || '').trim().slice(0, 500);
    const correct = parseInt(q.correct, 10);
    if (!text || options.length < 2 || !(correct >= 0 && correct < options.length)) return null;
    out.push({
      text, options, correct,
      points: Math.min(1000, Math.max(10, parseInt(q.points, 10) || 100)),
      time: Math.min(120, Math.max(5, parseInt(q.time, 10) || 20))
    });
  }
  return out;
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const isAdmin = req => req.headers['x-pw'] === ADMIN_PASSWORD;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET') {
    if (p === '/' || p === '/admin') {
      const name = p === '/' ? 'player.html' : 'admin.html';
      const f = [path.join(__dirname, 'public', name), path.join(__dirname, name)].find(x => fs.existsSync(x));
      if (!f) { res.writeHead(500); return res.end('Arquivo ' + name + ' não encontrado'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(f));
    }
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const c = { res, id: url.searchParams.get('id') };
      clients.add(c);
      const pl = players.get(c.id); if (pl) pl.online = true;
      res.write('data: ' + JSON.stringify(view()) + '\n\n');
      if (pl) broadcast();
      const hb = setInterval(() => res.write(': hb\n\n'), 20000);
      req.on('close', () => {
        clearInterval(hb); clients.delete(c);
        const q = players.get(c.id);
        if (q && ![...clients].some(x => x.id === c.id)) { q.online = false; broadcast(); }
      });
      return;
    }
    if (p === '/api/admin/questions') {
      if (!isAdmin(req)) return json(res, 401, { error: 'senha' });
      return json(res, 200, questions);
    }
    res.writeHead(404); return res.end('Não encontrado');
  }

  if (req.method === 'POST') {
    const b = await readBody(req);

    if (p === '/api/join') {
      let pl = b.id && players.get(b.id);
      if (!pl) {
        const name = String(b.name || '').trim().slice(0, 16);
        if (!name) return json(res, 400, { error: 'Digite um nome.' });
        if (players.size >= MAX_PLAYERS) return json(res, 403, { error: 'Sala cheia (25 jogadores).' });
        pl = { id: crypto.randomBytes(4).toString('hex'), name, color: COLORS[players.size % COLORS.length], points: 0, blocked: false, allin: false, online: true };
        players.set(pl.id, pl);
        bubble(pl.id, '👋 Entrou na sala!');
      }
      broadcast();
      return json(res, 200, { id: pl.id, name: pl.name });
    }

    if (p === '/api/answer') {
      const pl = players.get(b.id);
      const choice = parseInt(b.choice, 10);
      if (!pl || g.phase !== 'question' || pl.blocked || Date.now() > g.endsAt + 400) return json(res, 400, { error: 'não aceito' });
      if (g.answers.some(a => a.id === pl.id)) return json(res, 400, { error: 'já respondeu' });
      if (!(choice >= 0 && choice < questions[g.q].options.length)) return json(res, 400, { error: 'inválido' });
      g.answers.push({ id: pl.id, choice, t: Date.now() });
      const eligible = [...players.values()].filter(x => x.online && !x.blocked);
      if (eligible.length && eligible.every(x => g.answers.some(a => a.id === x.id))) closeQuestion();
      else broadcast();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/power') {
      const me = players.get(b.id), target = players.get(b.target);
      if (!me || !target || target.id === me.id || g.phase !== 'reveal' || g.firstId !== me.id || g.powerUsed || !['block', 'zero', 'steal'].includes(b.power))
        return json(res, 400, { error: 'não aceito' });
      g.powerUsed = true;
      applyPower(me, target, b.power);
      broadcast();
      return json(res, 200, { ok: true });
    }

    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Senha incorreta.' });
      const act = p.slice('/api/admin/'.length);
      if (act === 'login') return json(res, 200, { ok: true });
      if (act === 'questions') {
        const v = validQuestions(b.questions);
        if (!v) return json(res, 400, { error: 'Pergunta inválida: confira texto, alternativas e resposta correta.' });
        questions = v; saveQuestions(); return json(res, 200, { ok: true });
      }
      if (act === 'next') {
        if (g.phase === 'question') return json(res, 400, { error: 'pergunta em andamento' });
        if (g.q + 1 < questions.length && g.phase !== 'ended') startQuestion();
        else { g.phase = 'ended'; clearTimeout(g.timer); broadcast(); }
        return json(res, 200, { ok: true });
      }
      if (act === 'reveal') { closeQuestion(); return json(res, 200, { ok: true }); }
      if (act === 'end') { clearTimeout(g.timer); g.phase = 'ended'; broadcast(); return json(res, 200, { ok: true }); }
      if (act === 'reset') { resetGame(!!b.removePlayers); return json(res, 200, { ok: true }); }
      if (act === 'kick') { players.delete(b.id); delete bubbles[b.id]; broadcast(); return json(res, 200, { ok: true }); }
    }
  }
  res.writeHead(404); res.end('Não encontrado');
});

server.listen(PORT, () => console.log(`Quiz no ar na porta ${PORT}. Admin em /admin`));
