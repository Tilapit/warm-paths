"use client";
// The team's network on a canvas, flowing left to right: the team -> the
// people they know (an organic cloud per industry) -> industries -> the
// decision-makers who fit. Everyone outside the target industries is one
// compact grey cloud at the bottom. At rest it is dim and still: only the
// people in the list next to it are lit and labelled. The layout is seeded,
// never physics: the same data always gives the same picture. A static layer
// renders once per filter and size to an offscreen canvas; a scene layer adds
// what is picked, hovered or chosen; one short reveal on first load and the
// particles on a chosen person's path are drawn per frame on top.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DNode = {
  id: string;
  n: string; // name
  t: string; // title
  c: string; // company
  g: number; // group index
  f: 0 | 1 | 2; // 0 not on the list, 1 possible, 2 strong
  dm: boolean;
  k: number; // owner bitmask
  w: number; // the suggested sender's owner index
  s: number; // score
  sig: boolean;
  nf: boolean; // marked not a fit
  ip: boolean; // at a company in the target profile
  rx: number; // reactions to the team's posts in the last 30 days
};
export type DGroup = { id: string; label: string; short: string; grey: boolean };
export type DOwner = { id: string; name: string };

type P = { x: number; y: number; r: number };
type Hit = { kind: "contact" | "fit" | "group" | "owner" | "label" | "others"; i: number };
type Counts = { contacts: number; groups: number; fits: number };
type Box = [number, number, number, number];

const C = {
  bg: "#0e1115",
  text: "#e8eaed",
  text2: "#c3c8cf",
  muted: "#8b929c",
  faintText: "#6f7782",
  accent: "#3d7bff",
  sel: "#8db4ff",
  green: "#8fe0a6",
  // At rest the decision-makers who fit are a muted blue; the accent is for what is lit.
  strong: "#4a6fb8",
  possible: "#2f4b82",
  notFit: "#5e3b3b",
};
/** The one reveal on first load. */
const REVEAL_MS = 900;
// Canvas fonts cannot read CSS variables; resolved from the page once mounted.
let FF = "system-ui, sans-serif";

// ---------- layout ----------

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n points spread evenly but irregularly (best-candidate sampling) in a rounded blob w x h centred on 0,0. */
function scatter(n: number, w: number, h: number, rand: () => number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (!n) return out;
  const cell = Math.max(1.2, Math.sqrt((w * h * 0.8) / n));
  const cols = Math.ceil(w / cell) + 8;
  const grid = new Map<number, number[]>();
  const tries = n > 3000 ? 5 : 8;
  for (let i = 0; i < n; i++) {
    let bx = 0;
    let by = 0;
    let bd = -1;
    for (let k = 0; k < tries; k++) {
      let u = 0;
      let v = 0;
      do {
        u = rand() * 2 - 1;
        v = rand() * 2 - 1;
      } while (Math.abs(u) ** 2.4 + Math.abs(v) ** 2.4 > 1);
      const x = ((u + 1) * w) / 2;
      const y = ((v + 1) * h) / 2;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let d = cell * 9;
      for (let gy = cy - 2; gy <= cy + 2; gy++)
        for (let gx = cx - 2; gx <= cx + 2; gx++) {
          const list = grid.get((gy + 4) * cols + gx + 4);
          if (list) for (const j of list) d = Math.min(d, (out[j].x - x) ** 2 + (out[j].y - y) ** 2);
        }
      if (d > bd) {
        bd = d;
        bx = x;
        by = y;
      }
    }
    const key = (Math.floor(by / cell) + 4) * cols + Math.floor(bx / cell) + 4;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(out.length);
    out.push({ x: bx, y: by });
  }
  return out.map((p) => ({ x: p.x - w / 2, y: p.y - h / 2 }));
}

const importance = (n: DNode) => (n.f === 2 ? 3 : n.f === 1 ? 2 : n.dm ? 1 : 0);

/** Below this width the drawing uses the phone layout. */
const COMPACT = 640;

/** Taller when there are many industry bands (the broad profile), so their labels keep their spacing. */
export function heightFor(W: number, bands = 0) {
  return W < COMPACT ? Math.round(Math.max(480, Math.min(660, W * 1.55), 174 + bands * 30)) : Math.round(Math.max(600, Math.min(820, W * 0.68), 196 + bands * 34));
}

export function layout(nodes: DNode[], groups: DGroup[], owners: DOwner[], W: number, H: number) {
  const compact = W < COMPACT;
  const top = compact ? 40 : 54;
  // Compact: a strip at the bottom keeps the zoom buttons off the drawing.
  const bottom = compact ? 46 : 16;
  const span = H - top - bottom;
  const owner = compact ? 13 : Math.max(40, W * 0.048);
  const c0 = compact ? 28 : Math.max(128, W * 0.135);
  const label = compact ? W : W - (W >= 960 ? 200 : 180);
  const fit = compact ? W - 36 : label - 46;
  const group = compact ? W * 0.56 : c0 + (fit - c0) * 0.6;
  const c1 = compact ? W * 0.475 : group - Math.max(64, W * 0.08);
  const xs = { owner, c0, c1, group, fit, label };

  // One band per target industry; everyone else is one compact cloud below.
  const byGroup = groups.map(() => [] as number[]);
  nodes.forEach((n, i) => byGroup[n.g]?.push(i));
  const present = byGroup.map((l) => l.length > 0);
  const target = groups.map((g, gi) => present[gi] && !g.grey && byGroup[gi].some((i) => nodes[i].ip));
  const order = groups.map((_, g) => g).filter((g) => target[g]);
  const others = nodes.map((_, i) => i).filter((i) => !target[nodes[i].g]);
  const gap = compact ? 5 : 9;
  const otherH = !others.length ? 0 : !order.length ? span : Math.round(Math.max(compact ? 40 : 54, Math.min(compact ? 72 : 104, span * 0.14)));
  const split = others.length && order.length ? (compact ? 16 : 22) : 0;
  const tH = order.length ? span - otherH - split - gap * (order.length - 1) : 0;
  const heights = groups.map(() => 0);
  const w8 = order.map((g) => byGroup[g].length ** 0.8);
  const sw = w8.reduce((a, b) => a + b, 0) || 1;
  const minH = Math.min(compact ? 16 : 24, tH / Math.max(1, order.length));
  order.forEach((g, j) => (heights[g] = minH + ((tH - minH * order.length) * w8[j]) / sw));

  const contact: P[] = new Array(nodes.length);
  const full = c1 - c0;
  const cloud = (list: number[], cx: number, cy: number, w: number, h: number, rand: () => number, inProfile: boolean) => {
    const spacing = Math.sqrt((w * h * 0.8) / Math.max(1, list.length));
    // Fits lean to the right of their cloud, nearest their industry, with
    // enough noise that it never reads as a sorted list.
    const pts = scatter(list.length, w, h, rand).map((p) => ({ ...p, k: p.x + (rand() - 0.5) * w * 0.5 }));
    pts.sort((a, b) => b.k - a.k);
    const sorted = [...list].sort((a, b) => importance(nodes[b]) - importance(nodes[a]) || nodes[b].s - nodes[a].s || a - b);
    const scale = Math.max(0.55, Math.min(1, spacing / (inProfile ? 7.5 : 4.4))) * (compact ? 0.85 : 1);
    sorted.forEach((ni, k) => {
      const n = nodes[ni];
      const base = inProfile ? (n.f === 2 ? 3.1 : n.f === 1 ? 2.7 : n.dm ? 2.2 : 1.8) : n.dm ? 1.4 : 1.05;
      contact[ni] = { x: cx + pts[k].x, y: cy + pts[k].y, r: Math.max(0.7, base * scale) };
    });
  };
  const band = groups.map(() => ({ y0: 0, y1: 0, x0: 0, x1: 0 }));
  const maxT = Math.max(1, ...order.map((g) => byGroup[g].length));
  let y = top;
  order.forEach((g) => {
    const list = byGroup[g];
    const h = heights[g];
    const rand = mulberry32(0x5eed ^ (g * 7919) ^ (list.length * 104729));
    const w = full * (0.52 + 0.48 * Math.sqrt(list.length / maxT));
    const cx = c0 + full / 2 + (rand() - 0.5) * (full - w) * 0.9;
    band[g] = { y0: y, y1: y + h, x0: cx - w / 2, x1: cx + w / 2 };
    cloud(list, cx, y + h / 2, w, h, rand, true);
    y += h + gap;
  });
  const tBottom = order.length ? y - gap : top;
  const oy0 = order.length ? tBottom + split : top;
  const othersBand = { y0: oy0, y1: oy0 + otherH, x0: c0, x1: c1 };
  if (others.length) cloud(others, c0 + full / 2, oy0 + otherH / 2, full, otherH, mulberry32(0x07e5 ^ (others.length * 104729)), false);

  // Industry nodes at their band's centre, pushed apart so labels never overlap.
  const fitsIn = groups.map((_, g) => byGroup[g].filter((i) => nodes[i].f).length);
  const maxFits = Math.max(1, ...order.map((g) => fitsIn[g]));
  const colBot = order.length ? tBottom : top + span;
  const gy = order.map((g) => (band[g].y0 + band[g].y1) / 2);
  const minGap = compact ? 28 : 31;
  for (let i = 1; i < gy.length; i++) gy[i] = Math.max(gy[i], gy[i - 1] + minGap);
  for (let i = gy.length - 1; i >= 0; i--) gy[i] = Math.min(gy[i], i === gy.length - 1 ? colBot - 8 : gy[i + 1] - minGap);
  for (let i = 0; i < gy.length; i++) gy[i] = Math.max(gy[i], i ? gy[i - 1] + minGap : top + 10);
  const groupPos: P[] = groups.map(() => ({ x: group, y: 0, r: 0 }));
  order.forEach((g, i) => (groupPos[g] = { x: group, y: gy[i], r: (compact ? 3 : 4) + Math.sqrt(fitsIn[g] / maxFits) * (compact ? 4 : 6) }));

  // Decision-makers who fit: small dots over the height of the industries,
  // in staggered sub-columns, in band order so their links barely cross.
  const colSpan = Math.max(40, colBot - top);
  const rank = new Map(order.map((g, i) => [g, i]));
  const fitIdx = nodes.map((_, i) => i).filter((i) => nodes[i].f);
  fitIdx.sort((a, b) => (rank.get(nodes[a].g) ?? 0) - (rank.get(nodes[b].g) ?? 0) || nodes[b].s - nodes[a].s || a - b);
  const minStep = compact ? 5.5 : 7;
  let cols = 2;
  while (cols < 4 && Math.ceil(fitIdx.length / cols) * minStep > colSpan) cols++;
  const each = Math.min(compact ? 9 : 12, colSpan / Math.max(1, fitIdx.length));
  const y0 = top + (colSpan - each * fitIdx.length) / 2;
  const colGap = compact ? 6 : 8;
  const fr = compact ? 1.5 : 1.8;
  const jitter = mulberry32(0xf17 ^ fitIdx.length);
  const fitPos = new Map<number, P>();
  fitIdx.forEach((ni, j) => {
    const col = j % cols;
    fitPos.set(ni, { x: fit + (col - (cols - 1) / 2) * colGap + (jitter() - 0.5) * colGap * 0.6, y: y0 + (j + 0.5) * each, r: fr });
  });

  // The team: sized by their number of connections.
  const ownerCount = owners.map((_, o) => nodes.reduce((a, n) => a + (n.k & (1 << o) ? 1 : 0), 0));
  const maxO = Math.max(1, ...ownerCount);
  const ownerPos: P[] = owners.map((_, i) => ({
    x: owner,
    y: top + colSpan * (0.2 + (0.6 * (i + 0.5)) / owners.length),
    r: (compact ? 4 : 6) + (compact ? 2.5 : 4.5) * Math.sqrt(ownerCount[i] / maxO),
  }));

  const index = new Map(nodes.map((n, i) => [n.id, i]));
  // Mid widths keep the desktop layout but use short industry names when the
  // longest full name ("Wood and building products", about 170 px) would
  // reach the decision-makers' column.
  const short = compact || fit - group < 205;
  return { W, H, compact, short, top, colBot, xs, contact, band, target, present, order, others, othersBand, groupPos, fitsIn, fitPos, ownerPos, ownerCount, index };
}

type Layout = ReturnType<typeof layout>;
type Label = { ni: number; x: number; y: number; w: number };
type GLabel = { g: number; name: string; sub: string; x: number; y: number; fs1: number; box: Box };
type OLabel = { lines: string[]; x: number; y: number; box: Box };

/** The people in the list get a label in the lane right of the column, near their dot. */
function placeLabels(L: Layout, ids: string[]): Label[] {
  const idx = ids.map((id) => L.index.get(id)).filter((i): i is number => i !== undefined && L.fitPos.has(i));
  idx.sort((a, b) => L.fitPos.get(a)!.y - L.fitPos.get(b)!.y);
  const minGap = 38;
  const ys = idx.map((i) => L.fitPos.get(i)!.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + minGap);
  for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], i === ys.length - 1 ? L.colBot - 14 : ys[i + 1] - minGap);
  for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], i ? ys[i - 1] + minGap : L.top + 12);
  const x = L.xs.label + 18;
  return idx.map((ni, j) => ({ ni, x, y: ys[j], w: L.W - x - 6 }));
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Industry labels (and the line for everyone else), measured once per filter and size: drawn, and clickable. */
function measureLabels(ctx: CanvasRenderingContext2D, L: Layout, nodes: DNode[], groups: DGroup[], bit: number): { gl: GLabel[]; ol: OLabel | null } {
  const vis = (n: DNode) => !bit || (n.k & bit) !== 0;
  const fs1 = L.compact ? 12 : 13;
  const gl = L.order.map((g) => {
    const p = L.groupPos[g];
    let total = 0;
    let fits = 0;
    for (const n of nodes)
      if (n.g === g && vis(n)) {
        total++;
        if (n.f) fits++;
      }
    const name = L.short ? groups[g].short : groups[g].label;
    const sub = L.compact ? (fits ? `${fits} fit` : fmt(total)) : `${fmt(total)} people${fits ? ` · ${fits} fit` : ""}`;
    ctx.font = `500 ${fs1}px ${FF}`;
    const w1 = ctx.measureText(name).width;
    ctx.font = `12px ${FF}`;
    const w2 = ctx.measureText(sub).width;
    const x = p.x + p.r + (L.compact ? 5 : 8);
    return { g, name, sub, x, y: p.y, fs1, box: [p.x - p.r - 5, p.y - fs1 - 4, x + Math.max(w1, w2) + 4, p.y + 18] as Box };
  });
  const n = L.others.reduce((a, i) => a + (vis(nodes[i]) ? 1 : 0), 0);
  if (!n) return { gl, ol: null };
  const lines = L.compact ? [`${fmt(n)} others outside`, "your industries"] : [`${fmt(n)} others outside your industries`];
  const x = L.xs.group - 4;
  const y = (L.othersBand.y0 + L.othersBand.y1) / 2 - ((lines.length - 1) * 15) / 2;
  ctx.font = `${fs1}px ${FF}`;
  const w = Math.max(...lines.map((s) => ctx.measureText(s).width));
  return { gl, ol: { lines, x, y, box: [Math.min(x, L.othersBand.x0), L.othersBand.y0, x + w + 4, L.othersBand.y1] } };
}

const inBox = (b: Box, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// ---------- drawing helpers ----------

function curve(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  const mx = (ax + bx) / 2;
  ctx.moveTo(ax, ay);
  ctx.bezierCurveTo(mx, ay, mx, by, bx, by);
}

function onCurve(ax: number, ay: number, bx: number, by: number, t: number) {
  const mx = (ax + bx) / 2;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * ax + (b + c) * mx + d * bx, y: (a + b) * ay + (c + d) * by };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** One stroke per link, so overlapping links add up. */
function strokeEach(ctx: CanvasRenderingContext2D, segs: number[], color: string, width: number) {
  if (!segs.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < segs.length; i += 4) {
    ctx.beginPath();
    curve(ctx, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
    ctx.stroke();
  }
}

/** Faint links in batches: cheap, and they hardly add up. */
function strokeBatched(ctx: CanvasRenderingContext2D, segs: number[], color: string, width: number, per = 40) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < segs.length; i += 4 * per) {
    ctx.beginPath();
    for (let j = i; j < Math.min(segs.length, i + 4 * per); j += 4) curve(ctx, segs[j], segs[j + 1], segs[j + 2], segs[j + 3]);
    ctx.stroke();
  }
}

const glows = new Map<string, HTMLCanvasElement>();
/** A soft round glow in one colour, drawn with "lighter". */
function glow(rgb: string): HTMLCanvasElement {
  let g = glows.get(rgb);
  if (g) return g;
  g = document.createElement("canvas");
  g.width = g.height = 64;
  const x = g.getContext("2d")!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},0.55)`);
  grad.addColorStop(0.35, `rgba(${rgb},0.16)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  glows.set(rgb, g);
  return g;
}
const halo = (ctx: CanvasRenderingContext2D, rgb: string, x: number, y: number, R: number, a = 1) => {
  ctx.globalAlpha = a;
  ctx.drawImage(glow(rgb), x - R, y - R, 2 * R, 2 * R);
  ctx.globalAlpha = 1;
};

/** Text with a dark halo, so it reads on top of the links without a box. */
function haloText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, fill: string) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(14,17,21,0.9)";
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

function ellipsis(ctx: CanvasRenderingContext2D, s: string, w: number) {
  if (ctx.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > w) t = t.slice(0, -1);
  return t + "…";
}

// ---------- the static layer: everything, dim ----------

function drawStatic(ctx: CanvasRenderingContext2D, L: Layout, nodes: DNode[], owners: DOwner[], bit: number, counts: Counts, labels: { gl: GLabel[]; ol: OLabel | null }) {
  const { W, H, xs, compact } = L;
  const vis = (n: DNode) => !bit || (n.k & bit) !== 0;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Links, muted and faint. Drawn over each other they settle into soft
  // bands of one muted colour, never brighter; bigger networks are fainter.
  const shown = bit ? nodes.reduce((a, n) => a + (vis(n) ? 1 : 0), 0) : nodes.length;
  const dens = Math.max(0.4, Math.min(1, Math.sqrt(2600 / Math.max(1, shown))));
  const a = (rgb: string, alpha: number) => `rgba(${rgb},${(alpha * dens).toFixed(4)})`;
  ctx.lineCap = "round";
  const tOwn: number[] = [];
  const tOwnFit: number[] = [];
  const tIn: number[] = [];
  const tInFit: number[] = [];
  const oOwn: number[] = [];
  nodes.forEach((n, i) => {
    if (!vis(n)) return;
    const p = L.contact[i];
    const tg = L.target[n.g];
    for (let o = 0; o < owners.length; o++) {
      if (!(n.k & (1 << o)) || (bit && bit !== 1 << o)) continue;
      const op = L.ownerPos[o];
      (tg ? (n.f ? tOwnFit : tOwn) : oOwn).push(op.x, op.y, p.x, p.y);
    }
    if (tg) (n.f ? tInFit : tIn).push(p.x, p.y, L.groupPos[n.g].x, L.groupPos[n.g].y);
  });
  strokeBatched(ctx, oOwn, a("120,128,140", 0.014), 0.6);
  strokeEach(ctx, tOwn, a("95,115,155", 0.035), 0.7);
  strokeEach(ctx, tIn, a("95,115,155", 0.04), 0.7);
  strokeEach(ctx, tOwnFit, a("95,125,185", 0.045), 0.75);
  strokeEach(ctx, tInFit, a("95,125,185", 0.05), 0.75);
  const fOut: number[] = [];
  L.fitPos.forEach((p, i) => {
    const n = nodes[i];
    if (!vis(n) || n.nf) return;
    const gp = L.groupPos[n.g];
    fOut.push(gp.x, gp.y, p.x, p.y);
  });
  strokeEach(ctx, fOut, a("95,130,200", 0.05), 0.8);

  // A soft glow inside your industries' clouds, added up where they are dense; it never moves.
  ctx.globalCompositeOperation = "lighter";
  nodes.forEach((n, i) => {
    if (!vis(n) || !L.target[n.g]) return;
    const p = L.contact[i];
    halo(ctx, "70,105,190", p.x, p.y, 5 + p.r * 3.4, (n.f ? 0.3 : 0.2) * dens);
  });
  ctx.globalCompositeOperation = "source-over";

  // People: muted grey dots. The ones who fit are a shade lighter here and
  // blue only in the decision-makers' column, so nobody shows twice in blue.
  const paint = (color: string, pick: (n: DNode) => boolean, scale = 1) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    nodes.forEach((n, i) => pick(n) && dot(ctx, L.contact[i].x, L.contact[i].y, L.contact[i].r * scale));
    ctx.fill();
  };
  const tg = (n: DNode) => L.target[n.g];
  paint("rgba(60,66,76,0.28)", (n) => !vis(n), 0.85);
  paint("rgba(105,113,126,0.34)", (n) => vis(n) && !tg(n));
  paint("#2c333e", (n) => vis(n) && tg(n) && !n.f && !n.dm);
  paint("#373f4c", (n) => vis(n) && tg(n) && !n.f && n.dm);
  paint("#434c5a", (n) => vis(n) && !!n.f);

  // Decision-makers who fit: small dots; the lit and labelled ones are drawn bigger on top.
  L.fitPos.forEach((p, i) => {
    const n = nodes[i];
    ctx.globalAlpha = vis(n) ? 1 : 0.25;
    ctx.fillStyle = n.nf ? C.notFit : n.f === 2 ? C.strong : C.possible;
    ctx.beginPath();
    dot(ctx, p.x, p.y, p.r);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // The team.
  owners.forEach((o, i) => {
    const p = L.ownerPos[i];
    ctx.globalAlpha = !bit || bit === 1 << i ? 1 : 0.35;
    ctx.fillStyle = "#b9c0ca";
    ctx.beginPath();
    dot(ctx, p.x, p.y, p.r);
    ctx.fill();
    const name = compact ? o.name.split(" ")[0] : o.name;
    ctx.font = `500 ${compact ? 12 : 13}px ${FF}`;
    const tw = ctx.measureText(name).width;
    const lx = Math.max(3, p.x - tw / 2);
    const ly = p.y + p.r + 16;
    haloText(ctx, name, lx, ly, C.text2);
    ctx.font = `12px ${FF}`;
    haloText(ctx, compact ? fmt(L.ownerCount[i]) : `${fmt(L.ownerCount[i])} connections`, lx, ly + 15, C.faintText);
  });
  ctx.globalAlpha = 1;

  // Industries. Their counts add up to the people in your industries.
  for (const lb of labels.gl) {
    const p = L.groupPos[lb.g];
    ctx.fillStyle = L.fitsIn[lb.g] ? "#8792a5" : "#4a525f";
    ctx.beginPath();
    dot(ctx, p.x, p.y, p.r);
    ctx.fill();
    ctx.font = `500 ${lb.fs1}px ${FF}`;
    haloText(ctx, lb.name, lb.x, lb.y - 1, C.text2);
    ctx.font = `12px ${FF}`;
    haloText(ctx, lb.sub, lb.x, lb.y + 13, C.muted);
  }
  if (labels.ol) {
    ctx.font = `${compact ? 12 : 13}px ${FF}`;
    labels.ol.lines.forEach((s, j) => haloText(ctx, s, labels.ol!.x, labels.ol!.y + 4 + j * 15, C.muted));
  }

  // Column headers, in plain words.
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${compact ? 12 : 14}px ${FF}`;
  ctx.fillStyle = C.text2;
  const people = `People your team knows · ${fmt(counts.contacts)}`;
  if (!compact) {
    ctx.fillText("Your team", 14, 28);
    ctx.fillText(people, xs.c0, 28);
    ctx.fillText("Their industries", xs.group - 8, 28);
    ctx.fillText(`Decision-makers who fit · ${fmt(counts.fits)}`, xs.fit - 22, 28);
  } else {
    ctx.fillText(people, xs.c0, 20);
    const end = xs.c0 + ctx.measureText(people).width + 14;
    const long = `Decision-makers who fit · ${fmt(counts.fits)}`;
    const right = W - 6 - ctx.measureText(long).width >= end ? long : `Who fit · ${fmt(counts.fits)}`;
    ctx.fillText(right, W - 6 - ctx.measureText(right).width, 20);
  }
}

// ---------- the scene: static + what is lit ----------

type SceneOpts = { hg: number | null; pg: number | null; hov: number; sel: number; reacted: boolean; labels: Label[]; lit: number[]; gl: GLabel[]; bit: number };

/** Each teammate's route to a person; with `from`, only that teammate's. */
function pathSegs(L: Layout, nodes: DNode[], i: number, owners: number, bit: number, from = -1): number[][] {
  const n = nodes[i];
  const p = L.contact[i];
  const fp = L.fitPos.get(i);
  const routes: number[][] = [];
  for (let o = 0; o < owners; o++) {
    if (!(n.k & (1 << o)) || (bit && bit !== 1 << o && n.k & bit) || (from >= 0 && o !== from)) continue;
    const op = L.ownerPos[o];
    const r = [op.x, op.y, p.x, p.y];
    if (L.target[n.g]) {
      const gp = L.groupPos[n.g];
      r.push(p.x, p.y, gp.x, gp.y);
      if (fp) r.push(gp.x, gp.y, fp.x, fp.y);
    }
    routes.push(r);
  }
  return routes;
}

function drawScene(ctx: CanvasRenderingContext2D, L: Layout, nodes: DNode[], owners: DOwner[], o: SceneOpts) {
  const vis = (n: DNode) => !o.bit || (n.k & o.bit) !== 0;
  // An industry picked or a person chosen: everything else steps back.
  if (o.pg !== null || o.sel >= 0) {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(14,17,21,0.62)";
    ctx.fillRect(0, L.top - 14, L.W, L.H);
  }
  ctx.lineCap = "round";
  const industry = (g: number, strength: number) => {
    const own: number[] = [];
    const inn: number[] = [];
    const out: number[] = [];
    nodes.forEach((n, i) => {
      if (n.g !== g || !vis(n)) return;
      const p = L.contact[i];
      const gp = L.groupPos[n.g];
      inn.push(p.x, p.y, gp.x, gp.y);
      for (let k = 0; k < owners.length; k++) if (n.k & (1 << k) && (!o.bit || o.bit === 1 << k)) own.push(L.ownerPos[k].x, L.ownerPos[k].y, p.x, p.y);
      const fp = L.fitPos.get(i);
      if (fp && !n.nf) out.push(gp.x, gp.y, fp.x, fp.y);
    });
    ctx.globalCompositeOperation = "lighter";
    const many = inn.length / 4 > 1500;
    (many ? strokeBatched : strokeEach)(ctx, own, `rgba(141,180,255,${0.05 * strength})`, 0.7);
    (many ? strokeBatched : strokeEach)(ctx, inn, `rgba(141,180,255,${0.14 * strength})`, 0.8);
    strokeEach(ctx, out, `rgba(141,180,255,${0.45 * strength})`, 1);
    halo(ctx, "141,180,255", L.groupPos[g].x, L.groupPos[g].y, L.groupPos[g].r * 4, 0.8 * strength);
    ctx.globalCompositeOperation = "source-over";
    // Everyone in the industry alike; its decision-makers in their column.
    ctx.fillStyle = strength >= 1 ? "#6f7d96" : "#56627a";
    ctx.beginPath();
    nodes.forEach((n, i) => n.g === g && vis(n) && dot(ctx, L.contact[i].x, L.contact[i].y, Math.max(1.2, L.contact[i].r)));
    ctx.fill();
    ctx.fillStyle = C.sel;
    ctx.beginPath();
    L.fitPos.forEach((p, i) => nodes[i].g === g && vis(nodes[i]) && !nodes[i].nf && dot(ctx, p.x, p.y, p.r + 0.7));
    ctx.fill();
  };
  if (o.pg !== null && L.target[o.pg] && o.sel < 0) industry(o.pg, 1);
  if (o.hg !== null && L.target[o.hg] && o.hg !== o.pg && o.sel < 0) industry(o.hg, 0.6);

  if (o.reacted && o.sel < 0) {
    const own: number[] = [];
    nodes.forEach((n, i) => {
      if (!n.rx || !vis(n)) return;
      for (let k = 0; k < owners.length; k++) if (n.k & (1 << k) && (!o.bit || o.bit === 1 << k)) own.push(L.ownerPos[k].x, L.ownerPos[k].y, L.contact[i].x, L.contact[i].y);
    });
    ctx.globalCompositeOperation = "lighter";
    strokeEach(ctx, own, "rgba(143,224,166,0.2)", 0.9);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = C.green;
    ctx.beginPath();
    nodes.forEach((n, i) => n.rx && vis(n) && dot(ctx, L.contact[i].x, L.contact[i].y, Math.max(2.4, L.contact[i].r + 0.6)));
    ctx.fill();
  }

  const lit = (i: number, color: string, width: number, glowA: number, from = -1) => {
    const segs = pathSegs(L, nodes, i, owners.length, o.bit, from).flat();
    ctx.globalCompositeOperation = "lighter";
    strokeEach(ctx, segs, color, width);
    const p = L.contact[i];
    halo(ctx, "141,180,255", p.x, p.y, 12, glowA);
    const fp = L.fitPos.get(i);
    if (fp) halo(ctx, "141,180,255", fp.x, fp.y, 12, glowA);
    ctx.globalCompositeOperation = "source-over";
  };
  // At rest, the people in the list are lit; otherwise what is hovered or chosen.
  // At rest one line per person, from whoever writes (or the filtered teammate).
  if (o.pg === null && o.sel < 0 && !o.reacted)
    for (const i of o.lit) {
      const n = nodes[i];
      lit(i, "rgba(61,123,255,0.5)", 1.2, 0.45, !o.bit || o.bit === 1 << n.w ? n.w : Math.log2(o.bit));
    }
  if (o.hov >= 0 && o.hov !== o.sel) lit(o.hov, "rgba(141,180,255,0.7)", 1.2, 0.7);
  if (o.sel >= 0) lit(o.sel, "rgba(141,180,255,0.95)", 1.8, 1);
  for (const i of [o.hov, o.sel]) {
    if (i < 0) continue;
    const p = L.contact[i];
    ctx.fillStyle = C.sel;
    ctx.beginPath();
    dot(ctx, p.x, p.y, Math.max(3, p.r + 1.2));
    const fp = L.fitPos.get(i);
    if (fp) dot(ctx, fp.x, fp.y, fp.r + 2);
    ctx.fill();
  }
  const selG = o.sel >= 0 ? nodes[o.sel].g : -1;
  const focus = o.pg !== null || o.sel >= 0;
  for (const lb of o.gl) {
    const on = o.sel >= 0 ? lb.g === selG : lb.g === o.pg || lb.g === o.hg;
    ctx.fillStyle = on ? "rgba(14,17,21,0.88)" : "rgba(14,17,21,0.72)";
    ctx.beginPath();
    ctx.roundRect(lb.x - 4, lb.y - lb.fs1 - 3, lb.box[2] - lb.x + 2, lb.fs1 + 21, 4);
    ctx.fill();
    ctx.font = `${on ? 600 : 500} ${lb.fs1}px ${FF}`;
    haloText(ctx, lb.name, lb.x, lb.y - 1, on ? C.text : focus ? C.muted : C.text2);
    ctx.font = `12px ${FF}`;
    haloText(ctx, lb.sub, lb.x, lb.y + 13, on ? C.text2 : focus ? "#5b626c" : C.muted);
  }

  // Someone chosen who has no label in the lane: named where they are.
  if (o.sel >= 0 && !o.labels.some((lb) => lb.ni === o.sel)) {
    const fp = L.fitPos.get(o.sel);
    const p = fp ?? L.contact[o.sel];
    ctx.font = `600 13px ${FF}`;
    const name = nodes[o.sel].n;
    // In the column at the right edge, the name goes to the left of the dot.
    haloText(ctx, name, fp ? p.x - ctx.measureText(name).width - 10 : p.x + 8, fp ? p.y + 4 : p.y - 7, C.text);
  }

  // Labels for the people in the list.
  for (const lb of o.labels) {
    const n = nodes[lb.ni];
    const fp = L.fitPos.get(lb.ni)!;
    const chosen = o.sel === lb.ni;
    ctx.globalAlpha = o.sel < 0 || chosen ? 1 : 0.35;
    ctx.strokeStyle = chosen ? "rgba(141,180,255,0.7)" : "rgba(61,123,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fp.x + fp.r + 2, fp.y);
    ctx.bezierCurveTo(fp.x + 14, fp.y, lb.x - 22, lb.y, lb.x - 10, lb.y);
    ctx.stroke();
    ctx.fillStyle = chosen ? C.sel : n.nf ? C.notFit : C.accent;
    ctx.beginPath();
    dot(ctx, fp.x, fp.y, 3.2);
    dot(ctx, lb.x - 4, lb.y, 5);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = `600 13px ${FF}`;
    ctx.fillText(ellipsis(ctx, n.n, lb.w - 12), lb.x + 8, lb.y - 2);
    ctx.fillStyle = C.muted;
    ctx.font = `12px ${FF}`;
    ctx.fillText(ellipsis(ctx, n.c, lb.w - 12), lb.x + 8, lb.y + 13);
    ctx.globalAlpha = 1;
  }
}

// ---------- zoom ----------

type View = { z: number; x: number; y: number };
const HOME: View = { z: 1, x: 0, y: 0 };

/** Keeps the zoom between 1x and 6x and the drawing filling the frame. */
function clampView(v: View, W: number, H: number): View {
  const z = Math.max(1, Math.min(6, v.z));
  return { z, x: Math.min(0, Math.max(W * (1 - z), v.x)), y: Math.min(0, Math.max(H * (1 - z), v.y)) };
}

function zoomAt(v: View, cx: number, cy: number, f: number, W: number, H: number): View {
  const z = Math.max(1, Math.min(6, v.z * f));
  const k = z / v.z;
  return clampView({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, W, H);
}

// ---------- the component ----------

export function NetworkDrawing(props: {
  nodes: DNode[];
  groups: DGroup[];
  owners: DOwner[];
  owner: number; // -1 whole team, else owner index
  /** The people in the list next to the drawing: labelled, and lit when nothing is picked. */
  listIds: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** An industry hovered in the table: highlighted only. */
  hoverGroup: number | null;
  onHoverGroup: (g: number | null) => void;
  /** An industry clicked: only it is lit. */
  picked: number | null;
  onPick: (g: number | null) => void;
  counts: Counts;
  showReacted?: boolean;
  /** A person hovered in the list next to the drawing: lit like a hover. */
  focusId?: string | null;
}) {
  const { nodes, groups, owners, owner, listIds, selected, onSelect, hoverGroup, onHoverGroup, picked, onPick, counts, showReacted = false, focusId = null } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<{ gl: GLabel[]; ol: OLabel | null }>({ gl: [], ol: null });
  const [W, setW] = useState(0);
  const [fonts, setFonts] = useState(0);
  const [hover, setHover] = useState<Hit | null>(null);
  const [staticVersion, setStaticVersion] = useState(0);
  const anim = useRef({ raf: 0, pulse0: -1, pulsed: false, painted: false });
  const live = useRef<{ L: Layout | null; dpr: number; routes: number[][]; reduce: boolean; view: View; rview: View }>({ L: null, dpr: 1, routes: [], reduce: false, view: HOME, rview: HOME });
  const bands = useMemo(() => groups.filter((g, gi) => !g.grey && nodes.some((n) => n.g === gi && n.ip)).length, [groups, nodes]);
  const H = W ? heightFor(W, bands) : 0;
  // `view` follows the wheel and the drag at once (a scaled copy of the layers);
  // `rview` is what the layers were last rendered at, crisp, once the gesture rests.
  const [view, setView] = useState<View>(HOME);
  const [rview, setRview] = useState<View>(HOME);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  live.current.view = view;
  live.current.rview = rview;
  useEffect(() => {
    if (view === rview) return;
    const t = setTimeout(() => setRview(view), 140);
    return () => clearTimeout(t);
  }, [view, rview]);
  useEffect(() => {
    setView(HOME);
    setRview(HOME);
  }, [W]);
  const bit = owner >= 0 ? 1 << owner : 0;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    live.current.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ro = new ResizeObserver(() => setW(Math.max(300, Math.round(el.clientWidth))));
    ro.observe(el);
    // Canvas text drawn before the web font is in uses the fallback: draw again once it is.
    document.fonts?.ready.then(() => setFonts(1));
    return () => ro.disconnect();
  }, []);

  const L = useMemo(() => {
    if (!W) return null;
    const t0 = performance.now();
    const l = layout(nodes, groups, owners, W, H);
    performance.measure("vn:layout", { start: t0 });
    return l;
  }, [nodes, groups, owners, W, H]);
  const selIdx = selected && L ? L.index.get(selected) ?? -1 : -1;
  // The list's people are labelled; someone chosen from elsewhere is too.
  const labelIds = useMemo(() => (selected && !listIds.includes(selected) ? [...listIds, selected] : listIds), [listIds, selected]);
  const labels = useMemo(() => (L && !L.compact ? placeLabels(L, labelIds) : []), [L, labelIds]);
  const litIdx = useMemo(() => (L ? listIds.map((id) => L.index.get(id)).filter((i): i is number => i !== undefined) : []), [L, listIds]);
  live.current.L = L;
  useEffect(() => {
    // Where things are, for the screenshot scripts.
    if (L)
      (window as unknown as { __vnDrawing?: unknown }).__vnDrawing = {
        W: L.W,
        H: L.H,
        groups: groups.map((g, i) => ({ id: g.id, x: L.groupPos[i].x, y: L.groupPos[i].y, present: L.target[i] })),
        fits: [...L.fitPos.entries()].map(([i, p]) => ({ id: nodes[i].id, x: p.x, y: p.y })),
        labels: labels.map((lb) => ({ id: nodes[lb.ni].id, x: lb.x + 20, y: lb.y })),
      };
  }, [L, groups, nodes, labels]);

  // Grid hash for hit testing.
  const grid = useMemo(() => {
    const cell = 12;
    const m = new Map<number, Hit[]>();
    if (!L) return { cell, m };
    const add = (p: P, h: Hit, r: number) => {
      for (let gx = Math.floor((p.x - r) / cell); gx <= Math.floor((p.x + r) / cell); gx++)
        for (let gy = Math.floor((p.y - r) / cell); gy <= Math.floor((p.y + r) / cell); gy++) {
          const k = gy * 4096 + gx;
          (m.get(k) ?? m.set(k, []).get(k)!).push(h);
        }
    };
    // Each item sits in every cell its hit circle (at 1x zoom) touches; find() checks the circle.
    L.contact.forEach((p, i) => p && add(p, { kind: "contact", i }, Math.max(6, p.r + 3)));
    L.fitPos.forEach((p, i) => add(p, { kind: "fit", i }, 7));
    L.order.forEach((g) => add(L.groupPos[g], { kind: "group", i: g }, L.groupPos[g].r + 6));
    L.ownerPos.forEach((p, i) => add(p, { kind: "owner", i }, p.r + 8));
    return { cell, m };
  }, [L]);

  const posOf = useCallback(
    (h: Hit): P | null => (!L ? null : h.kind === "contact" ? L.contact[h.i] : h.kind === "fit" ? L.fitPos.get(h.i) ?? null : h.kind === "group" ? L.groupPos[h.i] : h.kind === "owner" ? L.ownerPos[h.i] : null),
    [L],
  );

  function find(x: number, y: number): Hit | null {
    for (const lb of labels) if (x >= lb.x - 14 && x <= lb.x + lb.w && Math.abs(y - lb.y) <= 16) return { kind: "label", i: lb.ni };
    // Industry names are as clickable as their nodes.
    for (const lb of textRef.current.gl) if (inBox(lb.box, x, y)) return { kind: "group", i: lb.g };
    const list = grid.m.get(Math.floor(y / grid.cell) * 4096 + Math.floor(x / grid.cell)) ?? [];
    // Hit circles in screen pixels: zoomed in, a click must land near the dot.
    const z = view.z;
    let best: Hit | null = null;
    let bd = Infinity;
    for (const h of list) {
      const p = posOf(h);
      if (!p) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const R = h.kind === "group" ? p.r + 6 / z : h.kind === "owner" ? p.r + 8 / z : Math.max(p.r + 3 / z, (h.kind === "fit" ? 7 : 6) / z);
      if (d > R * R) continue;
      const score = d - (h.kind === "group" ? 60 : h.kind === "owner" ? 120 : h.kind === "fit" ? 10 : 0) / (z * z);
      if (score < bd) {
        bd = score;
        best = h;
      }
    }
    if (best) return best;
    const ol = textRef.current.ol;
    return ol && inBox(ol.box, x, y) ? { kind: "others", i: 0 } : null;
  }

  // One frame: the scene (or the first-load reveal), then particles on the chosen path.
  const frame = useCallback((now: number) => {
    const a = anim.current;
    a.raf = 0;
    const cv = canvas.current;
    const scene = sceneRef.current;
    const st = staticRef.current;
    const { L, dpr, routes, reduce } = live.current;
    if (!cv || !scene || !st || !L) return;
    if (cv.width !== scene.width || cv.height !== scene.height) {
      cv.width = scene.width;
      cv.height = scene.height;
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    let more = false;
    const t = a.pulse0 >= 0 ? (now - a.pulse0) / REVEAL_MS : 1;
    if (t < 1) {
      // The reveal: one soft pass, the team -> people -> industries -> decision-makers.
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const X = Math.round((L.xs.owner - 30 + (L.W + 30 - L.xs.owner) * e) * dpr);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(scene, 0, 0);
      ctx.globalAlpha = 1;
      if (X > 0) ctx.drawImage(scene, 0, 0, Math.min(X, scene.width), scene.height, 0, 0, Math.min(X, scene.width), scene.height);
      ctx.globalCompositeOperation = "lighter";
      const band = 80 * dpr;
      for (let s = 0; s < 5; s++) {
        const x0 = Math.max(0, X - ((s + 1) * band) / 5);
        const x1 = Math.min(st.width, X - (s * band) / 5);
        if (x1 <= x0) continue;
        ctx.globalAlpha = 0.35 * (1 - s / 5) * Math.min(1, (1 - t) * 4);
        ctx.drawImage(st, x0, 0, x1 - x0, st.height, x0, 0, x1 - x0, st.height);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      more = true;
    } else {
      if (a.pulse0 >= 0) a.pulse0 = -1;
      const { view: v, rview: r } = live.current;
      const k = v.z / r.z;
      if (k !== 1 || v.x !== r.x || v.y !== r.y) {
        // Mid-gesture: the last crisp layers, scaled, until they are redrawn.
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.setTransform(k, 0, 0, k, dpr * (v.x - k * r.x), dpr * (v.y - k * r.y));
      }
      ctx.drawImage(scene, 0, 0);
    }
    if (routes.length && !reduce) {
      // Small particles flowing along the chosen person's path.
      const v = live.current.view;
      ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
      ctx.globalCompositeOperation = "lighter";
      const g = glow("170,200,255");
      for (const r of routes) {
        const nSeg = r.length / 4;
        for (let k = 0; k < 4; k++) {
          const s = ((now / 900 + (k * nSeg) / 4) % nSeg + nSeg) % nSeg;
          const j = Math.floor(s) * 4;
          const p = onCurve(r[j], r[j + 1], r[j + 2], r[j + 3], s - Math.floor(s));
          ctx.drawImage(g, p.x - 9, p.y - 9, 18, 18);
          ctx.fillStyle = "rgba(235,242,255,0.95)";
          ctx.beginPath();
          dot(ctx, p.x, p.y, 1.5);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      more = true;
    }
    if (!a.painted) {
      a.painted = true;
      performance.mark("vn:first-frame");
    }
    if (more) a.raf = requestAnimationFrame(frameRef.current);
  }, []);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  // Draws now when nothing is animating, so a resize never shows a stretched frame.
  const kick = useCallback(() => {
    if (!anim.current.raf) frameRef.current(performance.now());
  }, []);
  useEffect(() => () => cancelAnimationFrame(anim.current.raf), []);

  // Static layer: every link and node for this filter and size.
  useEffect(() => {
    if (!L) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    live.current.dpr = dpr;
    FF = getComputedStyle(document.body).fontFamily || FF;
    const off = staticRef.current ?? document.createElement("canvas");
    staticRef.current = off;
    off.width = Math.round(L.W * dpr);
    off.height = Math.round(L.H * dpr);
    const ctx = off.getContext("2d")!;
    ctx.setTransform(dpr * rview.z, 0, 0, dpr * rview.z, dpr * rview.x, dpr * rview.y);
    const t0 = performance.now();
    textRef.current = measureLabels(ctx, L, nodes, groups, bit);
    drawStatic(ctx, L, nodes, owners, bit, counts, textRef.current);
    performance.measure("vn:static", { start: t0 });
    if (!anim.current.pulsed) {
      anim.current.pulsed = true;
      if (!live.current.reduce) anim.current.pulse0 = performance.now();
    }
    setStaticVersion((v) => v + 1);
  }, [L, nodes, groups, owners, bit, counts, rview, fonts]);

  const hovIdx = hover && (hover.kind === "contact" || hover.kind === "fit" || hover.kind === "label") ? hover.i : focusId && L ? L.index.get(focusId) ?? -1 : -1;
  const hg = hoverGroup ?? (hover?.kind === "group" ? hover.i : null);

  // Scene layer: the static layer plus what is picked, hovered, chosen or toggled.
  useEffect(() => {
    const st = staticRef.current;
    if (!L || !st) return;
    const scene = sceneRef.current ?? document.createElement("canvas");
    sceneRef.current = scene;
    if (scene.width !== st.width || scene.height !== st.height) {
      scene.width = st.width;
      scene.height = st.height;
    }
    const ctx = scene.getContext("2d")!;
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(st, 0, 0);
    const dpr = live.current.dpr;
    const r = live.current.rview;
    ctx.setTransform(dpr * r.z, 0, 0, dpr * r.z, dpr * r.x, dpr * r.y);
    drawScene(ctx, L, nodes, owners, { hg, pg: picked, hov: hovIdx, sel: selIdx, reacted: showReacted, labels, lit: litIdx, gl: textRef.current.gl, bit });
    live.current.routes = selIdx >= 0 ? pathSegs(L, nodes, selIdx, owners.length, bit) : [];
    kick();
    performance.measure("vn:scene", { start: t0 });
  }, [staticVersion, L, nodes, owners, hg, picked, hovIdx, selIdx, showReacted, labels, litIdx, bit, kick]);
  useEffect(() => kick(), [view, kick]);

  // Ctrl or Cmd + wheel (and trackpad pinch) zooms around the pointer; plain wheel scrolls the page.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !L) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      setView((v) => zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01), L.W, L.H));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [L]);

  function tipFor(h: Hit): React.ReactNode {
    const shown = (n: DNode) => !bit || (n.k & bit) !== 0;
    if (h.kind === "group") {
      const g = groups[h.i];
      const vis = nodes.filter((n) => n.g === h.i && shown(n));
      return (
        <>
          <b>{g.label}</b>
          <br />
          <span className="muted">
            {fmt(vis.length)} people · {vis.filter((n) => n.f).length} decision-makers who fit
          </span>
          <br />
          <span className="xs faint">{picked === h.i ? "Click again to clear" : <><span className="hover-only">Click</span><span className="touch-only">Tap</span> to list them</>}</span>
        </>
      );
    }
    if (h.kind === "others") {
      const by = groups.map((g, i) => ({ g, n: L && !L.target[i] ? nodes.filter((n) => n.g === i && shown(n)).length : 0 })).filter((x) => x.n);
      return (
        <>
          <b>Outside your industries</b>
          <br />
          <span className="muted">{by.map((x) => `${x.g.label} ${fmt(x.n)}`).join(" · ")}</span>
        </>
      );
    }
    if (h.kind === "owner") {
      return (
        <>
          <b>{owners[h.i].name}</b>
          <br />
          <span className="muted">{fmt(L?.ownerCount[h.i] ?? 0)} connections</span>
        </>
      );
    }
    const n = nodes[h.i];
    return (
      <>
        <b>{n.n}</b>
        <br />
        <span className="muted">
          {n.t || "No title"}
          {n.c ? ` · ${n.c}` : ""}
        </span>
        <br />
        <span className="xs faint">
          {groups[n.g].label}
          {n.f === 2 ? " · Strong fit" : n.f === 1 ? " · Possible fit" : ""}
          {n.k & (n.k - 1) ? " · known by two or more of you" : ""}
          {n.rx ? " · reacted recently" : ""}
        </span>
      </>
    );
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * (L?.W ?? 1);
    const sy = ((e.clientY - rect.top) / rect.height) * (L?.H ?? 1);
    return { x: (sx - view.x) / view.z, y: (sy - view.y) / view.z, lx: e.clientX - rect.left, ly: e.clientY - rect.top };
  };
  const moveTip = (lx: number, ly: number) => {
    const el = tipEl.current;
    if (!el || !L) return;
    const w = el.offsetWidth || 240;
    el.style.left = `${Math.max(4, Math.min(lx + 14, L.W - w - 6))}px`;
    el.style.top = `${Math.min(ly + 14, L.H - (el.offsetHeight || 60) - 6)}px`;
  };
  const same = (a: Hit | null, b: Hit | null) => (a && b ? a.kind === b.kind && a.i === b.i : a === b);
  const person = (h: Hit | null) => !!h && (h.kind === "contact" || h.kind === "fit" || h.kind === "label");

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (view.z <= 1 || (e.pointerType !== "mouse" && e.pointerType !== "touch")) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (d && L) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        if (hover) setHover(null);
        setView(clampView({ z: d.v.z, x: d.v.x + dx, y: d.v.y + dy }, L.W, L.H));
        return;
      }
    }
    if (e.pointerType === "touch") return;
    const p = point(e);
    const h = find(p.x, p.y);
    if (!same(h, hover)) setHover(h);
    moveTip(p.lx, p.ly);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const p = point(e);
    const h = find(p.x, p.y);
    if (!h) {
      setHover(null);
      return onHoverGroup(null);
    }
    if (h.kind === "group") {
      setHover(null);
      return onPick(picked === h.i ? null : h.i);
    }
    if (h.kind === "owner" || h.kind === "others") {
      setHover(h);
      return moveTip(p.lx, p.ly);
    }
    // Touch: the first tap shows who it is, the second opens them.
    if (e.pointerType === "touch" && !(person(hover) && hover!.i === h.i)) {
      setHover(h);
      return moveTip(p.lx, p.ly);
    }
    setHover(null);
    onSelect(nodes[h.i].id);
  }

  return (
    <div ref={wrap} className="drawing-wrap">
      <div className="drawing" style={{ height: H || 600 }}>
        {L ? (
          <canvas
            ref={canvas}
            style={{ width: L.W, height: L.H, cursor: hover && hover.kind !== "owner" && hover.kind !== "others" ? "pointer" : view.z > 1 ? "grab" : "default", touchAction: view.z > 1 ? "none" : "manipulation" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
            role="img"
            aria-label={`Network drawing: ${counts.contacts} people you know, in ${counts.groups} industries, and ${counts.fits} decision-makers who fit. The list next to it has the same people.`}
          />
        ) : null}
        <div ref={tipEl} className="tip" style={{ display: hover ? "block" : "none" }}>
          {hover ? tipFor(hover) : null}
          {person(hover) ? <div className="xs faint tap-hint">Tap again to open</div> : null}
        </div>
        {L ? (
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" title="Zoom in (or Ctrl + scroll)" onClick={() => setView((v) => zoomAt(v, L.W / 2, L.H / 2, 1.6, L.W, L.H))}>
              +
            </button>
            <button type="button" aria-label="Zoom out" disabled={view.z <= 1} onClick={() => setView((v) => zoomAt(v, L.W / 2, L.H / 2, 1 / 1.6, L.W, L.H))}>
              −
            </button>
            {view.z > 1 ? (
              <button type="button" className="reset" onClick={() => setView(HOME)}>
                Reset
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
