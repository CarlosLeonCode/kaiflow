import type { Season } from "./season";

/**
 * Seasonal background ambience: a few slow sprites on one fixed, transparent 2D canvas that
 * sits above the page background and below all content (`z-index: -1` in the root stacking
 * context, so text, buttons and the tinted sections always paint over it).
 *
 * Every sprite kind is painted once into an offscreen texture per theme and blitted with
 * `drawImage` each frame. Motion is time based; small or touch screens render at DPR 1,
 * 30 fps and half the sprites.
 *
 * Blending: in dark mode embers, bokeh and glows use additive `lighter`, which makes them
 * read as light. On the light page additive blending washes out to white, so light mode uses
 * normal `source-over` with low alpha, and pale sprites (snow) get a faint blue-grey edge so
 * they stay visible on paper.
 */

type Theme = "light" | "dark";
type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) => void;

interface KindSpec {
  /** Sprites on desktop; small screens get half (at least one). */
  count: number;
  /** Rendered height in CSS px at the nearest depth. */
  size: [number, number];
  /** Main-axis speed in CSS px/s at the nearest depth. */
  speed: [number, number];
  /** `rise` floats up, `fall` drifts down, `fly` crosses sideways. */
  motion: "rise" | "fall" | "fly";
  alpha: Record<Theme, number>;
  /** Use additive blending in dark mode (see the note above). */
  additive: boolean;
  /** Texture width / height. */
  aspect?: number;
  /** Continuous rotation, max rad/s. */
  spin?: number;
  /** Gentle rocking amplitude in rad. */
  tilt?: number;
  flicker?: boolean;
  /** Wing beat drawn as a vertical squash. */
  wingBeat?: boolean;
  paint: Paint;
}

interface Sprite {
  kind: number;
  x: number;
  y: number;
  /** Depth, 0 far to 1 near: far sprites are smaller, dimmer and slower. */
  z: number;
  size: number;
  speed: number;
  dir: number;
  phase: number;
  rot: number;
  spin: number;
  age: number;
}

const INK = "#17140f";
const WASHI = "#f4efe6";
const VERMILION = "#e0452b";
const TEXTURE_HEIGHT = 96;

const rgba = (hex: string, a: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/* Texture painters. Each draws one sprite centered in a w×h canvas, leaving room for glow. */

const paintEmber: Paint = (ctx, w, h, theme) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h / 2);
  if (theme === "dark") {
    g.addColorStop(0, "rgba(255, 220, 170, 1)");
    g.addColorStop(0.18, "rgba(255, 150, 80, 0.9)");
    g.addColorStop(0.5, rgba(VERMILION, 0.3));
  } else {
    g.addColorStop(0, rgba(VERMILION, 1));
    g.addColorStop(0.22, "rgba(226, 104, 50, 0.75)");
    g.addColorStop(0.55, "rgba(232, 140, 70, 0.18)");
  }
  g.addColorStop(1, "rgba(232, 140, 70, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

const paintBat: Paint = (ctx, w, h, theme) => {
  const color = theme === "dark" ? WASHI : INK;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = h * 0.04;
  // The silhouette is authored in a 200×100 box.
  ctx.translate(w * 0.06, h * 0.08);
  ctx.scale((w * 0.88) / 200, (h * 0.84) / 100);
  ctx.beginPath();
  ctx.moveTo(100, 42);
  // Right wing: leading edge to the tip, then a scalloped trailing edge back to the tail.
  ctx.quadraticCurveTo(142, 10, 196, 8);
  ctx.quadraticCurveTo(182, 30, 176, 58);
  ctx.quadraticCurveTo(164, 44, 150, 56);
  ctx.quadraticCurveTo(140, 48, 130, 72);
  ctx.quadraticCurveTo(118, 58, 105, 68);
  ctx.lineTo(100, 80);
  // Left wing, mirrored.
  ctx.lineTo(95, 68);
  ctx.quadraticCurveTo(82, 58, 70, 72);
  ctx.quadraticCurveTo(60, 48, 50, 56);
  ctx.quadraticCurveTo(36, 44, 24, 58);
  ctx.quadraticCurveTo(18, 30, 4, 8);
  ctx.quadraticCurveTo(58, 10, 100, 42);
  ctx.closePath();
  ctx.fill();
  // Body, head and two small ears.
  ctx.beginPath();
  ctx.ellipse(100, 56, 7, 16, 0, 0, Math.PI * 2);
  ctx.ellipse(100, 40, 7, 8, 0, 0, Math.PI * 2);
  ctx.moveTo(94, 37);
  ctx.lineTo(94, 27);
  ctx.lineTo(99, 34);
  ctx.moveTo(106, 37);
  ctx.lineTo(106, 27);
  ctx.lineTo(101, 34);
  ctx.fill();
};

/** Soft, blurred disc. `edge` adds a faint ring so pale discs still read on light paper. */
const bokeh =
  (light: string, dark: string, edge?: string): Paint =>
  (ctx, w, h, theme) => {
    const color = theme === "dark" ? dark : light;
    const r = h / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
    g.addColorStop(0, rgba(color, 0.9));
    g.addColorStop(0.5, rgba(color, 0.75));
    g.addColorStop(0.78, rgba(color, 0.3));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (edge && theme === "light") {
      ctx.strokeStyle = edge;
      ctx.lineWidth = h * 0.06;
      ctx.shadowColor = edge;
      ctx.shadowBlur = h * 0.12;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

const paintFlake: Paint = (ctx, w, h, theme) => {
  const stroke = theme === "dark" ? WASHI : "#7f90a4";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = h * 0.026;
  ctx.lineCap = "round";
  ctx.shadowColor = theme === "dark" ? "rgba(220, 232, 255, 0.9)" : "rgba(127, 144, 164, 0.55)";
  ctx.shadowBlur = h * 0.08;
  ctx.translate(w / 2, h / 2);
  const r = h * 0.32;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    for (const [at, len] of [
      [0.48, 0.16],
      [0.72, 0.12],
    ] as const) {
      ctx.moveTo(0, -r * at);
      ctx.lineTo(-r * len, -r * (at + len));
      ctx.moveTo(0, -r * at);
      ctx.lineTo(r * len, -r * (at + len));
    }
    ctx.stroke();
    ctx.rotate(Math.PI / 3);
  }
};

const paintHeart: Paint = (ctx, w, h, theme) => {
  const s = h * 0.29;
  const cx = w / 2;
  const cy = h / 2 + s * 0.05;
  ctx.strokeStyle = theme === "dark" ? "#ff8b78" : VERMILION;
  ctx.lineWidth = h * 0.032;
  ctx.lineJoin = "round";
  ctx.shadowColor = theme === "dark" ? "rgba(255, 120, 110, 0.85)" : rgba(VERMILION, 0.45);
  ctx.shadowBlur = h * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 0.9 * s);
  ctx.bezierCurveTo(cx - 1.6 * s, cy - 0.1 * s, cx - 0.9 * s, cy - 1.25 * s, cx, cy - 0.45 * s);
  ctx.bezierCurveTo(cx + 0.9 * s, cy - 1.25 * s, cx + 1.6 * s, cy - 0.1 * s, cx, cy + 0.9 * s);
  ctx.closePath();
  ctx.stroke();
};

const SEASON_KINDS: Record<Season, KindSpec[]> = {
  halloween: [
    {
      count: 32,
      size: [12, 26],
      speed: [22, 46],
      motion: "rise",
      alpha: { light: 0.7, dark: 0.95 },
      additive: true,
      flicker: true,
      paint: paintEmber,
    },
    {
      count: 4,
      size: [24, 38],
      speed: [26, 42],
      motion: "fly",
      alpha: { light: 0.24, dark: 0.15 },
      additive: false,
      aspect: 2,
      wingBeat: true,
      paint: paintBat,
    },
  ],
  christmas: [
    {
      count: 28,
      size: [14, 46],
      speed: [12, 26],
      motion: "fall",
      alpha: { light: 0.8, dark: 0.3 },
      additive: true,
      paint: bokeh("#d8e0ea", "#f4f6fa", "rgba(96, 116, 140, 0.2)"),
    },
    {
      count: 8,
      size: [26, 40],
      speed: [16, 28],
      motion: "fall",
      alpha: { light: 0.7, dark: 0.65 },
      additive: true,
      spin: 0.35,
      paint: paintFlake,
    },
  ],
  valentine: [
    {
      count: 16,
      size: [16, 50],
      speed: [8, 16],
      motion: "rise",
      alpha: { light: 0.42, dark: 0.28 },
      additive: true,
      paint: bokeh("#f2a9a2", "#ff8fa0"),
    },
    {
      count: 8,
      size: [12, 32],
      speed: [8, 14],
      motion: "rise",
      alpha: { light: 0.18, dark: 0.22 },
      additive: true,
      paint: bokeh(VERMILION, VERMILION),
    },
    {
      count: 9,
      size: [24, 38],
      speed: [10, 18],
      motion: "rise",
      alpha: { light: 0.55, dark: 0.6 },
      additive: true,
      tilt: 0.28,
      paint: paintHeart,
    },
  ],
};

const SMALL_SCREEN = "(max-width: 819px), (pointer: coarse)";
const DARK = "(prefers-color-scheme: dark)";

/**
 * Mounts the ambience canvas for a season and starts animating. Returns a cleanup that stops
 * the loop, removes listeners and the canvas.
 */
export function mountAmbience(season: Season): () => void {
  const kinds = SEASON_KINDS[season];
  const small = window.matchMedia(SMALL_SCREEN);
  const dark = window.matchMedia(DARK);

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.season = season;
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1";
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  document.body.prepend(canvas);

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frameInterval = 0;
  let theme: Theme = "light";
  let textures: HTMLCanvasElement[] = [];
  const sprites: Sprite[] = [];

  const buildTextures = () => {
    theme = dark.matches ? "dark" : "light";
    textures = kinds.map((kind) => {
      const tex = document.createElement("canvas");
      tex.height = TEXTURE_HEIGHT;
      tex.width = Math.round(TEXTURE_HEIGHT * (kind.aspect ?? 1));
      const tctx = tex.getContext("2d");
      if (tctx) kind.paint(tctx, tex.width, tex.height, theme);
      return tex;
    });
  };

  /** Places a sprite just outside the edge it enters from, or anywhere on the first frame. */
  const place = (sprite: Sprite, initial: boolean) => {
    const kind = kinds[sprite.kind];
    const margin = sprite.size * (kind.aspect ?? 1);
    if (initial) {
      sprite.x = rand(0, width);
      sprite.y = kind.motion === "fly" ? rand(height * 0.08, height * 0.6) : rand(0, height);
    } else if (kind.motion === "rise") {
      sprite.x = rand(0, width);
      sprite.y = height + margin;
    } else if (kind.motion === "fall") {
      sprite.x = rand(0, width);
      sprite.y = -margin;
    } else {
      sprite.x = sprite.dir > 0 ? -margin : width + margin;
      sprite.y = rand(height * 0.08, height * 0.6);
    }
  };

  const createSprite = (kindIndex: number): Sprite => {
    const kind = kinds[kindIndex];
    const z = Math.random();
    const depth = 0.55 + 0.45 * z;
    const sprite: Sprite = {
      kind: kindIndex,
      x: 0,
      y: 0,
      z,
      size: rand(kind.size[0], kind.size[1]) * depth,
      speed: rand(kind.speed[0], kind.speed[1]) * (0.35 + 0.65 * z),
      dir: Math.random() < 0.5 ? -1 : 1,
      phase: rand(0, Math.PI * 2),
      rot: rand(0, Math.PI * 2),
      spin: kind.spin ? rand(-kind.spin, kind.spin) : 0,
      age: 0,
    };
    place(sprite, true);
    return sprite;
  };

  /** Adds or trims sprites to match the target count for the current screen size. */
  const syncSprites = () => {
    kinds.forEach((kind, index) => {
      const target = small.matches ? Math.max(1, Math.round(kind.count / 2)) : kind.count;
      const current = sprites.filter((s) => s.kind === index);
      for (let i = current.length; i < target; i++) sprites.push(createSprite(index));
      for (let i = target; i < current.length; i++) sprites.splice(sprites.indexOf(current[i]), 1);
    });
    // Far sprites first so near ones paint over them.
    sprites.sort((a, b) => a.z - b.z);
  };

  const resize = () => {
    dpr = small.matches ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    frameInterval = small.matches ? 1000 / 30 : 0;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    syncSprites();
  };

  const step = (sprite: Sprite, dt: number, t: number) => {
    const kind = kinds[sprite.kind];
    const margin = sprite.size * (kind.aspect ?? 1);
    sprite.age += dt;
    sprite.rot += sprite.spin * dt;
    const sway = Math.sin(t * 0.6 + sprite.phase) * (6 + 10 * sprite.z) * dt;
    if (kind.motion === "rise") {
      sprite.y -= sprite.speed * dt;
      sprite.x += sway + Math.cos(t * 1.7 + sprite.phase) * 4 * dt;
      if (sprite.y < -margin) place(sprite, false);
    } else if (kind.motion === "fall") {
      sprite.y += sprite.speed * dt;
      sprite.x += sway;
      if (sprite.y > height + margin) place(sprite, false);
    } else {
      sprite.x += sprite.dir * sprite.speed * dt;
      sprite.y += Math.sin(t * 0.9 + sprite.phase) * 12 * dt;
      if (sprite.x < -margin * 1.5 || sprite.x > width + margin * 1.5) place(sprite, false);
    }
  };

  const draw = (t: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bandX = Math.max(40, width * 0.06);
    const bandY = Math.max(60, height * 0.12);
    for (const sprite of sprites) {
      const kind = kinds[sprite.kind];
      // Fade near every edge and on the first second, so nothing pops in or out.
      const edge = smooth(Math.min(sprite.x, width - sprite.x) / bandX) * smooth(Math.min(sprite.y, height - sprite.y) / bandY);
      let alpha = kind.alpha[theme] * (0.45 + 0.55 * sprite.z) * edge * smooth(sprite.age);
      if (kind.flicker) {
        alpha *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 7 + sprite.phase)) * (0.6 + 0.4 * Math.sin(t * 2.3 + sprite.phase * 1.7));
      }
      if (alpha <= 0.004) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.globalCompositeOperation = kind.additive && theme === "dark" ? "lighter" : "source-over";

      const h = sprite.size;
      const w = h * (kind.aspect ?? 1);
      const squash = kind.wingBeat ? 0.5 + 0.5 * Math.abs(Math.sin(t * 4.5 + sprite.phase)) : 1;
      const angle = sprite.rot * (kind.spin ? 1 : 0) + (kind.tilt ? Math.sin(t * 0.7 + sprite.phase) * kind.tilt : 0);
      const cos = Math.cos(angle) * dpr;
      const sin = Math.sin(angle) * dpr;
      ctx.setTransform(cos, sin, -sin, cos, sprite.x * dpr, sprite.y * dpr);
      ctx.drawImage(textures[sprite.kind], -w / 2, (-h * squash) / 2, w, h * squash);
    }
  };

  let frame = 0;
  let last = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const elapsed = now - last;
    // Small screens cap at 30 fps; the 1 ms slack keeps 60 Hz displays from dropping to 20.
    if (elapsed < frameInterval - 1) return;
    // Clamp long gaps (tab switches, jank) so sprites never jump.
    const dt = Math.min(elapsed, 100) / 1000;
    last = now;
    const t = now / 1000;
    for (const sprite of sprites) step(sprite, dt, t);
    draw(t);
  };

  const start = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onVisibility = () => (document.hidden ? stop() : start());
  let resizeQueued = false;
  const onResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  };

  buildTextures();
  resize();
  window.addEventListener("resize", onResize);
  small.addEventListener("change", onResize);
  dark.addEventListener("change", buildTextures);
  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) start();

  return () => {
    stop();
    window.removeEventListener("resize", onResize);
    small.removeEventListener("change", onResize);
    dark.removeEventListener("change", buildTextures);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.remove();
  };
}
