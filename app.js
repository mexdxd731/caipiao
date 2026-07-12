"use strict";
const DATA_BASE = "https://raw.githubusercontent.com/wenjinliuu/lottery-data-repo/main/public_data/draws";
const N = 50;
const BASE_W = 0.5;

const GAMES = {
  ssq: { label: "双色球", rule: "红球 6/33 + 蓝球 1/16",
    pools: [
      { key: "red",  pick: 6,  max: 33, kind: "red",  sort: true },
      { key: "blue", pick: 1,  max: 16, kind: "blue", sort: true }
    ] },
  dlt: { label: "大乐透", rule: "前区 5/35 + 后区 2/12",
    pools: [
      { key: "front", pick: 5, max: 35, kind: "front", sort: true },
      { key: "back",  pick: 2, max: 12, kind: "back",  sort: true }
    ] },
  pl5: { label: "排列五", rule: "5 位数字 0-9（每位独立）",
    positional: { key: "digits", count: 5 } }
};
const ALL_GAMES = ["ssq", "dlt", "pl5"];

const els = {
  tabs:  document.getElementById("tabs"),
  rule:  document.getElementById("rule"),
  balls: document.getElementById("balls"),
  genBtn:   document.getElementById("genBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  freq:  document.getElementById("freq"),
  recentList: document.getElementById("recentList"),
  metaInfo:  document.getElementById("metaInfo"),
  statsSection:  document.getElementById("statsSection"),
  recentSection: document.getElementById("recentSection")
};

const state = { game: "ssq", draws: null, loading: false, allDraws: {} };

// ---------- 数据获取 ----------
function cacheKey(g){ return "lot-data-" + g; }
function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function pickKey(g){ return "lot-pick-" + g + "-" + todayStr(); }
function getPick(g){ const raw = localStorage.getItem(pickKey(g)); return raw ? JSON.parse(raw) : null; }
function setPick(g, result){ localStorage.setItem(pickKey(g), JSON.stringify({ date: todayStr(), result })); }

async function getDraws(game){
  const url = `${DATA_BASE}/${game}.json?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const draws = Array.isArray(data.draws) ? data.draws : [];
    localStorage.setItem(cacheKey(game), JSON.stringify({ ts: Date.now(), updated_at: data.updated_at, draws }));
    return { draws, updated_at: data.updated_at, fresh: true };
  } catch (e) {
    const raw = localStorage.getItem(cacheKey(game));
    if (raw) { const c = JSON.parse(raw); return { draws: c.draws, updated_at: c.updated_at, fresh: false }; }
    return { draws: null, updated_at: null, fresh: false, error: e.message };
  }
}

// ---------- 算法 ----------
function weightedSample(candidates, weights, k){
  const pool = candidates.slice();
  const w = weights.slice();
  const out = [];
  for (let n = 0; n < k && pool.length > 0; n++) {
    let total = 0; for (let j = 0; j < w.length; j++) total += w[j];
    let r = Math.random() * total, idx = 0;
    for (let j = 0; j < w.length; j++) { if (r < w[j]) { idx = j; break; } r -= w[j]; idx = j; }
    out.push(pool[idx]);
    pool.splice(idx, 1); w.splice(idx, 1);
  }
  return out;
}

function predict(draws, conf){
  const recent = draws.slice(0, N);

  if (conf.pools) {
    const groups = conf.pools.map(p => {
      const freq = new Array(p.max + 1).fill(0);
      for (const d of recent) {
        const arr = (d.numbers && d.numbers[p.key]) || [];
        for (const v of arr) if (v >= 1 && v <= p.max) freq[v]++;
      }
      const cand = []; for (let v = 1; v <= p.max; v++) cand.push(v);
      const weights = cand.map(v => BASE_W + freq[v]);
      let chosen = weightedSample(cand, weights, p.pick);
      if (p.sort) chosen = chosen.sort((a, b) => a - b);
      return { ...p, chosen, freq };
    });
    return { type: "pools", groups };
  }

  // positional
  const count = conf.positional.count;
  const freq = Array.from({ length: count }, () => new Array(10).fill(0));
  for (const d of recent) {
    const arr = (d.numbers && d.numbers[conf.positional.key]) || [];
    for (let i = 0; i < count && i < arr.length; i++) {
      const v = arr[i]; if (v >= 0 && v <= 9) freq[i][v]++;
    }
  }
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const cand = [0,1,2,3,4,5,6,7,8,9];
    const w = cand.map(v => BASE_W + freq[i][v]);
    chosen.push(weightedSample(cand, w, 1)[0]);
  }
  return { type: "positional", chosen, freq };
}

// ---------- 渲染 ----------
const pad2 = (v) => (v < 10 ? "0" + v : "" + v);

function renderPredict(result, conf){
  els.balls.innerHTML = "";
  if (!result) {
    els.balls.innerHTML = `<span class="empty">点击下方按钮生成一组推荐</span>`;
    return;
  }
  if (result.type === "pools") {
    result.groups.forEach((g, gi) => {
      if (gi > 0) { const s = document.createElement("span"); s.className = "sep"; els.balls.appendChild(s); }
      g.chosen.forEach(v => {
        const b = document.createElement("div");
        b.className = "ball " + g.kind;
        b.textContent = pad2(v);
        els.balls.appendChild(b);
      });
    });
  } else {
    result.chosen.forEach(v => {
      const b = document.createElement("div");
      b.className = "ball digit";
      b.textContent = "" + v;
      els.balls.appendChild(b);
    });
  }
}

function classifyHot(freq){
  let sum = 0, cnt = 0;
  for (let i = 1; i < freq.length; i++) { sum += freq[i]; cnt++; }
  const avg = cnt ? sum / cnt : 0;
  return (i) => freq[i] >= avg * 1.3 ? "hot" : (freq[i] >= avg ? "warm" : "");
}

function renderFreq(result, conf){
  els.freq.innerHTML = "";
  if (!result) { els.freq.innerHTML = `<span class="empty">无数据</span>`; return; }
  if (result.type === "pools") {
    result.groups.forEach((g, gi) => {
      if (gi > 0) { const s = document.createElement("span"); s.className = "sep"; s.style.height = "20px"; els.freq.appendChild(s); }
      const cls = classifyHot(g.freq);
      for (let v = 1; v <= g.max; v++) {
        const chip = document.createElement("div");
        const tag = cls(v);
        chip.className = "freq-chip " + tag;
        chip.innerHTML = `<span class="n">${pad2(v)}</span>${g.freq[v]}`;
        els.freq.appendChild(chip);
      }
    });
  } else {
    // positional: aggregate counts per digit
    const agg = new Array(10).fill(0);
    for (let i = 0; i < result.freq.length; i++)
      for (let d = 0; d <= 9; d++) agg[d] += result.freq[i][d];
    const cls = classifyHot([0].concat(agg));
    for (let d = 0; d <= 9; d++) {
      const chip = document.createElement("div");
      const tag = cls(d + 1);
      chip.className = "freq-chip " + tag;
      chip.innerHTML = `<span class="n">${d}</span>${agg[d]}`;
      els.freq.appendChild(chip);
    }
  }
}

function renderRecent(draws, conf){
  els.recentList.innerHTML = "";
  if (!draws || !draws.length) {
    els.recentList.innerHTML = `<li class="empty">无数据</li>`;
    return;
  }
  const list = draws.slice(0, 10);
  for (const d of list) {
    const li = document.createElement("li");
    const issue = document.createElement("span");
    issue.className = "issue"; issue.textContent = d.issue || d.draw_date || "";
    const nums = document.createElement("div"); nums.className = "nums";
    if (conf.pools) {
      conf.pools.forEach((p, pi) => {
        if (pi > 0) { const s = document.createElement("span"); s.className = "mini-sep"; nums.appendChild(s); }
        const arr = (d.numbers && d.numbers[p.key]) || [];
        arr.forEach(v => {
          const b = document.createElement("span");
          b.className = "mini-ball " + (p.kind === "red" || p.kind === "front" ? "red" : "blue");
          b.textContent = pad2(v);
          nums.appendChild(b);
        });
      });
    } else {
      const arr = (d.numbers && d.numbers[conf.positional.key]) || [];
      arr.forEach(v => {
        const b = document.createElement("span");
        b.className = "mini-ball digit";
        b.textContent = "" + v;
        nums.appendChild(b);
      });
    }
    li.appendChild(issue); li.appendChild(nums);
    els.recentList.appendChild(li);
  }
}

function renderMeta(info){
  const c = GAMES[state.game];
  if (!info) { els.metaInfo.textContent = "无数据 · 使用缓存"; return; }
  const d = info.updated_at ? info.updated_at.slice(0, 16).replace("T", " ") : "?";
  els.metaInfo.textContent = `${c.label} · 最近50期数据` + (info.fresh ? ` · 更新${d}` : ` · 离线缓存${d}`);
}

// ---------- 整合视图（一起去打票） ----------
function reasonText(result) {
  if (result.type === "pools") {
    let hot = 0, cold = 0;
    for (const g of result.groups) {
      const ks = classifyHot(g.freq);
      let s = 0, m = 0, tt = 0;
      for (let v = 1; v <= g.max; v++) { tt++; if (g.freq[v] > 0) s++; m += g.freq[v]; }
      for (const v of g.chosen) {
        const tag = ks(v);
        if (tag === "hot") hot++;
        else if (tag === "") cold++;
      }
    }
    return `近50期热度加权 · 热号${hot}个 冷号${cold}个 · 回避长遗漏`;
  } else {
    const agg = new Array(result.chosen.length).fill(0);
    for (let i = 0; i < result.freq.length; i++)
      for (let d = 0; d <= 9; d++) agg[i === 0 ? 0 : 0] += result.freq[i][d];
    const total = result.freq.flat().reduce((a, b) => a + b, 0);
    const max = Math.max(...result.freq.flatMap(row => row));
    return `按位独立采样 · 各位高频号优先 · 最高出现${max}次`;
  }
}

function renderAllRows(results) {
  els.balls.innerHTML = "";
  if (!results) {
    els.balls.innerHTML = `<span class="empty">点击下方按钮生成三组号码</span>`;
    return;
  }
  for (const { game, result, conf } of results) {
    const row = document.createElement("div");
    row.className = "ball-row";
    const label = document.createElement("div");
    label.className = "ball-row-label";
    label.textContent = conf.label;
    row.appendChild(label);
    const cell = document.createElement("div");
    cell.className = "ball-row-cell";
    if (result.type === "pools") {
      result.groups.forEach((g, gi) => {
        if (gi > 0) { const s = document.createElement("span"); s.className = "sep"; cell.appendChild(s); }
        g.chosen.forEach(v => {
          const b = document.createElement("div");
          b.className = "ball " + g.kind;
          b.textContent = pad2(v);
          cell.appendChild(b);
        });
      });
    } else {
      result.chosen.forEach(v => {
        const b = document.createElement("div");
        b.className = "ball digit";
        b.textContent = "" + v;
        cell.appendChild(b);
      });
    }
    row.appendChild(cell);

    const reason = document.createElement("div");
    reason.className = "ball-row-reason";
    reason.textContent = "推荐原因：" + reasonText(result);
    row.appendChild(reason);

    els.balls.appendChild(row);
  }
}

async function loadAll(showToast) {
  els.rule.textContent = "一次生成 · 双色球 + 大乐透 + 排列五";
  els.balls.innerHTML = `<div class="loading-spin"></div>`;
  els.statsSection.style.display = "none";
  els.recentSection.style.display = "none";
  els.freq.innerHTML = "";
  els.recentList.innerHTML = "";
  els.metaInfo.textContent = "加载中…";
  setGenBtn(false, "生成今日推荐");
  state.loading = true;

  const makers = ALL_GAMES.map(g => getDraws(g).then(info => ({ game: g, info })));
  const settled = await Promise.all(makers);
  state.loading = false;

  const ok = [];
  let latestInfo = null, anyFresh = false;
  for (const { game, info } of settled) {
    if (info.draws && info.draws.length) {
      state.allDraws[game] = info.draws;
      ok.push({ game, info });
      if (!latestInfo || (info.updated_at || "") > (latestInfo.updated_at || "")) latestInfo = info;
      if (info.fresh) anyFresh = true;
    }
  }
  if (!ok.length) {
    els.balls.innerHTML = `<span class="error">数据加载失败，请检查网络后点「刷新数据」</span>`;
    els.metaInfo.textContent = "无数据";
    return;
  }
  els.metaInfo.textContent = `三玩法就绪 · ${ok.length}/3` + (latestInfo && latestInfo.updated_at
    ? ` · 最新更新${latestInfo.updated_at.slice(0, 16).replace("T", " ")}${anyFresh ? "" : "（离线）"}` : "");

  // 渲染已固定的 picks（若有）；否则提示生成
  const results = ALL_GAMES
    .filter(g => state.allDraws[g] && state.allDraws[g].length && getPick(g))
    .map(g => ({ game: g, conf: GAMES[g], result: getPick(g).result }));
  if (results.length === ALL_GAMES.length) {
    renderAllRows(results);
    setGenBtn(true, "今日已固定 · 明日再生成");
  } else if (results.length) {
    renderAllRows(results);
    els.balls.insertAdjacentHTML("beforeend", `<div class="empty" style="width:100%;margin-top:6px;">仍有玩法未生成 · 点下方按钮补齐</div>`);
    setGenBtn(false, "补齐今日推荐");
  } else {
    renderAllRows(null);
    setGenBtn(false, "生成今日推荐");
  }
}

function genAll() {
  if (state.loading) return;
  const results = [];
  for (const g of ALL_GAMES) {
    const draws = state.allDraws[g];
    if (!draws || !draws.length) continue;
    let pick = getPick(g);
    if (!pick) { const r = predict(draws, GAMES[g]); setPick(g, r); pick = { result: r }; }
    results.push({ game: g, conf: GAMES[g], result: pick.result });
  }
  renderAllRows(results.length ? results : null);
  setGenBtn(true, "今日已固定 · 明日再生成");
}

function setGenBtn(disabled, text){
  els.genBtn.disabled = disabled;
  els.genBtn.textContent = text;
  els.genBtn.classList.toggle("disabled", disabled);
}

async function load(showToast){
  if (state.game === "all") return loadAll(showToast);
  const conf = GAMES[state.game];
  els.rule.textContent = `规则：${conf.rule}`;
  els.balls.innerHTML = `<div class="loading-spin"></div>`;
  els.statsSection.style.display = "";
  els.recentSection.style.display = "";
  els.freq.innerHTML = "";
  els.recentList.innerHTML = "";
  els.metaInfo.textContent = "加载中…";
  setGenBtn(true, "生成今日推荐");
  state.loading = true;

  const info = await getDraws(state.game);
  state.loading = false;

  if (!info.draws || !info.draws.length) {
    els.balls.innerHTML = `<span class="error">数据加载失败，请检查网络后点「刷新数据」</span>`;
    els.metaInfo.textContent = info.error ? `错误：${info.error}` : "无数据";
    return;
  }
  state.draws = info.draws;
  renderRecent(info.draws, conf);
  renderMeta(info);

  const pick = getPick(state.game);
  if (pick) {
    renderPredict(pick.result, conf);
    renderFreq(pick.result, conf);
    setGenBtn(true, "今日已固定 · 明日再生成");
    els.metaInfo.textContent += " · 今日推荐已固定";
  } else {
    els.balls.innerHTML = `<span class="empty">点击下方按钮生成今日推荐（仅一次）</span>`;
    setGenBtn(false, "生成今日推荐");
  }
  if (showToast && !info.fresh) els.metaInfo.textContent = "（离线缓存数据）";
}

function gen(){
  if (state.loading) return;
  if (state.game === "all") return genAll();
  if (getPick(state.game)) return;
  const conf = GAMES[state.game];
  if (!state.draws || !state.draws.length) { load(); return; }
  const result = predict(state.draws, conf);
  setPick(state.game, result);
  renderPredict(result, conf);
  renderFreq(result, conf);
  setGenBtn(true, "今日已固定 · 明日再生成");
}

els.tabs.addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  if (btn.dataset.game === state.game) return;
  els.tabs.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.game = btn.dataset.game;
  state.draws = null;
  load(false);
});

els.genBtn.addEventListener("click", gen);
els.refreshBtn.addEventListener("click", () => {
  if (state.game === "all") {
    ALL_GAMES.forEach(g => localStorage.removeItem(cacheKey(g)));
  } else {
    localStorage.removeItem(cacheKey(state.game));
  }
  load(true);
});

// PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

load(false);