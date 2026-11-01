"use client";

import React, { useEffect, useRef } from "react";

export default function CircularCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Inyectar los estilos CSS originales omitiendo animaciones de texto
    const styleId = "circular-carousel-styles";
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.innerHTML = `
        .circular-carousel {
          --cc-fade: #000000;
          --cc-radius: 12px;
          --cc-inner: 0.4;
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          outline: none;
          touch-action: pan-y;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .circular-carousel[data-axis='x'] { touch-action: pan-x; }
        .circular-carousel[data-draggable] { cursor: grab; }
        .circular-carousel[data-dragging] { cursor: grabbing; }
        .circular-carousel:focus-visible { box-shadow: inset 0 0 0 2px rgba(128, 128, 140, 0.55); }
        .circular-carousel__view { position: absolute; inset: 0; }
        .circular-carousel[data-shape='wheel'] .circular-carousel__view {
          -webkit-mask-image: linear-gradient(to bottom, transparent, #000000 18%, #000000 82%, transparent);
          mask-image: linear-gradient(to bottom, transparent, #000000 18%, #000000 82%, transparent);
        }
        .circular-carousel[data-shape='panorama'] .circular-carousel__view {
          -webkit-mask-image: linear-gradient(to right, transparent, #000000 12%, #000000 88%, transparent);
          mask-image: linear-gradient(to right, transparent, #000000 12%, #000000 88%, transparent);
        }
        .circular-carousel__stage {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.45s ease;
        }
        .circular-carousel[data-ready] .circular-carousel__stage { opacity: 1; }
        .circular-carousel__camera,
        .circular-carousel__ring,
        .circular-carousel__card { width: 0; height: 0; transform-style: preserve-3d; }
        .circular-carousel__camera { position: relative; }
        .circular-carousel__ring,
        .circular-carousel__card { position: absolute; left: 0; top: 0; }
        .circular-carousel__tile {
          position: absolute;
          outline: 1px solid transparent;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .circular-carousel__frame { position: absolute; left: 0; top: 0; width: 100%; overflow: hidden; }
        .circular-carousel__photo {
          position: absolute; display: block; max-width: none; object-fit: cover;
          pointer-events: none; user-select: none; -webkit-user-drag: none;
        }
        .circular-carousel__shade,
        .circular-carousel__inner { position: absolute; inset: 0; pointer-events: none; }
        .circular-carousel__shade { background: var(--cc-fade); opacity: var(--cc-depth, 0); }
        .circular-carousel__inner { background: #000000; opacity: var(--cc-inner); }
        /* Ocultamos captions y textos inferiores */
        .circular-carousel__caption,
        .circular-carousel__live {
          display: none !important;
        }
      `;
      document.head.appendChild(styleEl);
    }

    const wrap = containerRef.current;
    wrap.innerHTML = ""; // Limpiar cualquier render previo para evitar bugs

    const photo = (id: string) => `https://images.unsplash.com/${id}?w=900&q=80&auto=format&fit=max&sat=-100`;

    const ITEMS = [
      { src: photo('photo-1506744038136-46273834b3fb'), alt: 'Campus 1' },
      { src: photo('photo-1524504388940-b1c1722653e1'), alt: 'Campus 2' },
      { src: photo('photo-1486406146926-c627a92ad1ab'), alt: 'Campus 3' },
      { src: photo('photo-1502680390469-be75c86b636f'), alt: 'Campus 4' },
      { src: photo('photo-1487958449943-2429e8be8625'), alt: 'Campus 5' },
      { src: photo('photo-1509631179647-0177331693ae'), alt: 'Campus 6' },
      { src: photo('photo-1519681393784-d120267933ba'), alt: 'Campus 7' },
      { src: photo('photo-1485968579580-b6d095142e6e'), alt: 'Campus 8' },
      { src: photo('photo-1493246507139-91e8fad9978e'), alt: 'Campus 9' },
      { src: photo('photo-1511818966892-d7d671e672a2'), alt: 'Campus 10' }
    ];

    const CONFIG = {
      preset: 'cylinder',
      intro: 'rise',
      cardWidth: 220,
      aspectRatio: 1,
      speed: 12,
      captions: false, // Desactivar textos en la configuración
      gap: 25,
      curve: undefined,
      tilt: undefined,
      perspective: undefined,
      autoplay: 'drift',
      interval: 3,
      direction: 'left',
      draggable: true,
      momentum: 0.6,
      snap: true,
      pauseOnHover: true,
      focusOnClick: true,
      parallax: 0.3,
      stretch: 0.5,
      depthFade: 0.55,
      fadeColor: '#000000',
      innerShade: 0.6,
      cornerRadius: 12
    };

    const PRESETS: Record<string, any> = {
      cylinder: { axis: 'y', tilt: -5, perspective: 2500, curve: 1, spread: 1, inward: false, billboard: false, backfaces: true, window: 0 }
    };

    const INTRO_LENGTH: Record<string, number> = { assemble: 1500, rise: 1400, spin: 1800, none: 0 };
    const TILES = 8;
    const OVERLAP = 2.5;
    const DRAG_THRESHOLD = 5;
    const SPRING = 118;
    const SETTLE_SPEED = 9;
    const TO_RAD = Math.PI / 180;

    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    const wrapFunc = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
    const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

    const rotateX = (p: number[], deg: number) => {
      const r = deg * TO_RAD, c = Math.cos(r), s = Math.sin(r);
      return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
    };
    const rotateY = (p: number[], deg: number) => {
      const r = deg * TO_RAD, c = Math.cos(r), s = Math.sin(r);
      return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    };

    const C = CONFIG;
    const list = ITEMS;
    const count = list.length;
    const shape = PRESETS[C.preset] ? C.preset : 'cylinder';
    const layout = PRESETS[shape];
    const axis = layout.axis;
    const tiltValue = C.tilt ?? layout.tilt;
    const curveValue = layout.billboard ? 0 : clamp(C.curve ?? layout.curve, 0, 1);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const cardW = Math.max(40, C.cardWidth);
    const cardH = cardW / clamp(C.aspectRatio, 0.2, 5);
    const along = axis === 'x' ? cardH : cardW;
    const step = 360 / count;

    const radius = (() => {
      const n = Math.max(count, 3);
      const pitch = (along + C.gap) * layout.spread;
      const chord = pitch / (2 * Math.sin(Math.PI / n));
      const arc = (n * pitch) / (2 * Math.PI);
      return Math.max(chord + (arc - chord) * curveValue, along * 0.6);
    })();

    const tiles = (() => {
      const total = curveValue > 0.001 ? TILES : 1;
      const length = along / total;
      const bend = curveValue > 0.001 ? radius / curveValue : 0;
      return Array.from({ length: total }, (_, index) => {
        const start = index * length - (index > 0 ? OVERLAP / 2 : 0);
        const end = (index + 1) * length + (index < total - 1 ? OVERLAP / 2 : 0);
        const center = (start + end) / 2 - along / 2;
        const alpha = bend ? center / bend : 0;
        const shift = bend ? bend * Math.sin(alpha) : center;
        const sink = bend ? bend * (1 - Math.cos(alpha)) : 0;
        const depth = layout.inward ? sink : -sink;
        const turn = ((layout.inward ? -alpha : alpha) * 180) / Math.PI;
        const move = axis === 'x'
          ? `translate3d(0px, ${shift}px, ${depth}px) rotateX(${-turn}deg)`
          : `translate3d(${shift}px, 0px, ${depth}px) rotateY(${turn}deg)`;
        return { index, total, start, end, size: end - start, move };
      });
    })();

    const s = {
      count, step, radius, layout, axis,
      tilt: tiltValue,
      perspective: layout.inward ? radius : (C.perspective ?? layout.perspective),
      cardW, cardH,
      intro: reduced ? 'none' : (C.intro in INTRO_LENGTH ? C.intro : 'rise'),
      autoplay: reduced ? 'off' : C.autoplay,
      speed: C.speed,
      interval: Math.max(0.5, C.interval),
      draggable: C.draggable,
      momentum: clamp(C.momentum, 0, 1),
      snap: C.snap,
      pauseOnHover: C.pauseOnHover,
      parallax: reduced ? 0 : clamp(C.parallax, 0, 1),
      stretch: reduced ? 0 : clamp(C.stretch, 0, 1),
      depthFade: clamp(C.depthFade, 0, 1),
      captions: false,
      reduced
    };

    const dragSign = layout.inward ? -1 : 1;
    const directionSign = (C.direction === 'right' ? 1 : -1) * dragSign;

    const el = (tag: string, cls?: string, parent?: HTMLElement) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (parent) parent.appendChild(e);
      return e;
    };

    const root = el('div', 'circular-carousel', wrap);
    root.style.setProperty('--cc-fade', C.fadeColor);
    root.style.setProperty('--cc-radius', `${Math.max(0, C.cornerRadius)}px`);
    root.style.setProperty('--cc-inner', (1 - clamp(C.innerShade, 0, 1)).toFixed(3));
    root.tabIndex = 0;
    root.dataset.axis = axis;
    root.dataset.shape = shape;
    if (C.draggable) root.dataset.draggable = '';

    const view = el('div', 'circular-carousel__view', root);
    const stage = el('div', 'circular-carousel__stage', view);
    const camera = el('div', 'circular-carousel__camera', stage);
    const ring = el('div', 'circular-carousel__ring', camera);
    const cardEls: HTMLElement[] = [];

    const makeTile = (item: any, tile: any, back: boolean) => {
      const strip = back ? tile.total - 1 - tile.index : tile.index;
      const first = strip === 0;
      const last = strip === tile.total - 1;
      const r = 'var(--cc-radius)';
      const frameRadius = axis === 'x'
        ? `${first ? r : 0} ${first ? r : 0} ${last ? r : 0} ${last ? r : 0}`
        : `${first ? r : 0} ${last ? r : 0} ${last ? r : 0} ${first ? r : 0}`;
      const offset = back ? along - tile.end : tile.start;
      const size = tile.size;
      const flip = axis === 'x' ? ' rotateX(180deg)' : ' rotateY(180deg)';

      const t = el('div', 'circular-carousel__tile');
      t.setAttribute('aria-hidden', 'true');
      if (axis === 'x') Object.assign(t.style, { left: `${-cardW / 2}px`, top: `${-size / 2}px`, width: `${cardW}px`, height: `${size}px` });
      else Object.assign(t.style, { left: `${-size / 2}px`, top: `${-cardH / 2}px`, width: `${size}px`, height: `${cardH}px` });
      t.style.transform = tile.move + (back ? flip : '');

      const frame = el('div', 'circular-carousel__frame', t);
      frame.style.height = `${axis === 'x' ? size : cardH}px`;
      frame.style.borderRadius = frameRadius;

      const img = el('img', 'circular-carousel__photo', frame) as HTMLImageElement;
      img.src = item.src;
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      if (axis === 'x') Object.assign(img.style, { left: '0px', top: `${-offset}px`, width: `${cardW}px`, height: `${cardH}px` });
      else Object.assign(img.style, { left: `${-offset}px`, top: '0px', width: `${cardW}px`, height: `${cardH}px` });

      if (back) el('div', 'circular-carousel__inner', frame);
      el('div', 'circular-carousel__shade', frame);
      return t;
    };

    list.forEach((item, index) => {
      const card = el('div', 'circular-carousel__card', ring);
      card.dataset.ccIndex = String(index);
      tiles.forEach(tile => card.appendChild(makeTile(item, tile, false)));
      if (layout.backfaces) tiles.forEach(tile => card.appendChild(makeTile(item, tile, true)));
      cardEls[index] = card;
    });

    const state: any = {
      angle: 0, velocity: 0, target: null, dir: directionSign, press: null, drag: false, hover: false,
      pointer: { inside: false, x: 0, y: 0 }, yaw: 0, pitch: 0,
      intro: null, introDone: false, holdUntil: 0, stepAt: 0, suppressClick: false,
      fit: 1, shift: 0, drop: 0, last: 0
    };
    let ready = false;
    let raf = 0;
    let visible = true;

    const nearest = (a: number) => Math.round(a / s.step) * s.step;

    const measure = () => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const width = rect.width * 0.94;
      const height = rect.height * 0.92;
      const P = s.perspective;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      if (s.layout.inward) {
        minX = -width / 2; maxX = width / 2;
        minY = -s.cardH / 2; maxY = s.cardH / 2;
      } else {
        const corners = [
          [-s.cardW / 2, -s.cardH / 2], [s.cardW / 2, -s.cardH / 2],
          [-s.cardW / 2, s.cardH / 2], [s.cardW / 2, s.cardH / 2]
        ];
        const limit = s.layout.window ? s.layout.window * s.step : 180;
        for (let a = -limit; a <= limit; a += limit / 24) {
          for (const [cx, cy] of corners) {
            let p;
            if (s.axis === 'x') p = rotateY(rotateX([cx, cy, s.radius], -a), s.tilt);
            else p = rotateX(rotateY([cx, cy, s.radius], a), s.tilt);
            p = [p[0], p[1], p[2] - s.radius];
            if (p[2] >= P * 0.95) continue;
            const k = P / (P - p[2]);
            minX = Math.min(minX, p[0] * k); maxX = Math.max(maxX, p[0] * k);
            minY = Math.min(minY, p[1] * k); maxY = Math.max(maxY, p[1] * k);
          }
        }
      }
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      const fit = Math.min(1, width / spanX, height / spanY);
      state.fit = fit;
      state.shift = -((minY + maxY) / 2) * fit;
      state.drop = s.axis === 'x' ? (rect.width / fit) * 0.55 + s.cardW : (rect.height / fit) * 0.55 + s.cardH;
      stage.style.perspective = `${P}px`;
      stage.style.transform = `translate3d(0, ${state.shift}px, 0) scale(${fit})`;
    };

    const introCard = (elapsed: number, landing: number) => {
      if (!state.intro) return { radius: 1, lift: 0 };
      const type = state.intro.type;
      const reach = Math.abs(wrapFunc(landing + state.angle));
      if (type === 'rise') {
        const delay = (reach / 180) * 480;
        const p = easeOutQuint(clamp((elapsed - delay) / 900, 0, 1));
        return { radius: 1, lift: (1 - p) * state.drop };
      }
      return { radius: 1, lift: 0 };
    };

    const advance = (dt: number, now: number) => {
      if (!state.introDone && ready) {
        if (!state.intro) {
          if (s.intro === 'none') state.introDone = true;
          else state.intro = { type: s.intro, start: now };
        }
        if (state.intro && now - state.intro.start >= INTRO_LENGTH[state.intro.type]) {
          state.intro = null;
          state.introDone = true;
        }
      }

      const paused = (s.pauseOnHover && state.hover) || state.drag || now < state.holdUntil;
      const cruise = s.autoplay === 'drift' && !paused && !state.intro ? s.speed * state.dir : 0;
      let busy = Boolean(state.intro) || state.drag;

      if (state.drag || state.intro) {
        state.velocity = state.drag ? state.velocity : 0;
      } else if (state.target !== null) {
        let remaining = dt;
        const damping = 2 * Math.sqrt(SPRING);
        while (remaining > 0) {
          const h = Math.min(remaining, 1 / 240);
          const accel = SPRING * (state.target - state.angle) - damping * state.velocity;
          state.velocity += accel * h;
          state.angle += state.velocity * h;
          remaining -= h;
        }
        if (Math.abs(state.target - state.angle) < 0.004 && Math.abs(state.velocity) < 0.03) {
          state.angle = state.target;
          state.velocity = 0;
          state.target = null;
        }
        busy = true;
      } else {
        const tau = 0.18 + s.momentum * 1.5;
        state.velocity += (cruise - state.velocity) * (1 - Math.exp(-dt / tau));
        state.angle += state.velocity * dt;
        if (cruise === 0 && s.snap && Math.abs(state.velocity) < SETTLE_SPEED) {
          state.target = nearest(state.angle);
        }
        busy = busy || cruise !== 0 || Math.abs(state.velocity) > 0.01 || state.target !== null;
      }

      if (now < state.holdUntil) busy = true;

      const ease = 1 - Math.exp(-dt / 0.35);
      const aimYaw = state.pointer.inside ? state.pointer.x * s.parallax * 9 : 0;
      const aimPitch = state.pointer.inside ? -state.pointer.y * s.parallax * 6 : 0;
      state.yaw += (aimYaw - state.yaw) * ease;
      state.pitch += (aimPitch - state.pitch) * ease;
      if (Math.abs(aimYaw - state.yaw) > 0.01 || Math.abs(aimPitch - state.pitch) > 0.01) busy = true;

      return busy;
    };

    const render = (now: number) => {
      const elapsed = state.intro ? now - state.intro.start : 0;
      const swell = 1 + s.stretch * 0.12 * Math.min(1, Math.abs(state.velocity) / 420);
      const angle = state.angle;
      const R = s.radius * swell;

      camera.style.transform = `translate3d(0, 0, ${-R}px) rotateX(${s.tilt + state.pitch}deg) rotateY(${state.yaw}deg)`;
      ring.style.transform = `rotateY(${angle}deg)`;

      for (let index = 0; index < s.count; index++) {
        const card = cardEls[index];
        if (!card) continue;
        const base = index * s.step;
        const mod = introCard(elapsed, base);
        const r = R * mod.radius;
        let transform = `rotateY(${base}deg) translateZ(${r}px)`;
        if (mod.lift) transform += ` translateY(${mod.lift}px)`;
        card.style.transform = transform;

        const world = wrapFunc(base + angle);
        const facing = Math.cos(world * TO_RAD);
        const fade = s.depthFade * Math.pow((1 - facing) / 2, 1.25);
        card.style.setProperty('--cc-depth', fade.toFixed(3));
      }
    };

    const frame = (now: number) => {
      const dt = state.last ? Math.min((now - state.last) / 1000, 0.05) : 1 / 60;
      state.last = now;
      const busy = advance(dt, now);
      render(now);
      if (busy) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = requestAnimationFrame(frame); // Forzar loop activo continuo sin congelamientos
      }
    };

    measure();
    render(performance.now());
    ready = true;
    root.dataset.ready = '';
    raf = requestAnimationFrame(frame);

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="w-full relative my-6">
      <div id="wrap" ref={containerRef} className="w-full h-[380px] md:h-[440px] relative overflow-hidden rounded-3xl" />
    </div>
  );
}