import { useEffect, useRef } from 'react';
import { motionReduced } from '../lib/motion';

/**
 * Northern lights over a night sky, after a photo of an aurora over a lake: two great ribbons of green light, each
 * dipping from the top of the sky down to the horizon behind the mountains and climbing back up the other side, and
 * six more that start close to you (high up, or at the sides) and run away into the distance, all meeting at one
 * point on the horizon behind the mountains, where they gather into a bright glow. Their rays hang almost straight up
 * from each ribbon's lower edge (fanning out a little, as if seen from below), on the receding ones long close by and
 * shorter towards the horizon; deep green (yellow-green low over the horizon), violet at the tips, drawn mostly as soft
 * glow; a green haze lights the whole sky. Behind them a dark sky with twinkling stars; in front a black, rocky
 * mountain range (a dark, farther one behind it) and a lake that reflects it all.
 *
 * Each ribbon's lower edge follows a hand-drawn curve (smoothed through its points), swaying slowly sideways
 * (overlapping sine waves, so it never repeats visibly), and its brightness shimmers along it, which shows as rays
 * coming and going. The rays are drawn at half size on a layer of their own, which is then laid over the sky twice:
 * blurred (the soft glow) and sharp (the rays).
 *
 * The lights brighten towards the pointer; a click on the page itself (not on a card, button or field) sends a pulse
 * of brightness out along them. It always paints its own dark sky (in the light theme Home keeps its cards light over
 * it). It pauses while the window is hidden; with Reduce motion it draws one still picture.
 */
export function Aurora({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /** Spacing of the rays along a ribbon, and each ray's width (px). The rays overlap (and the glow blurs them), so
     *  this can be wider than a ray is thin; it sets how many rays are drawn, the effect's main cost. */
    const SPACING = 5;
    const RAY_WIDTH = 14;
    /** The longest a frame is shown (ms): at most 30 frames a second. */
    const FRAME_MS = 1000 / 30;
    /** The horizon (where the mountains meet the lake), as a share of the height. */
    const HORIZON = 0.8;
    /** The share of a ray picture below the ribbon's edge (a soft glow under it). */
    const EDGE = 0.08;
    /** The rays' layer is drawn at this scale (cheaper; the glow hides the difference). */
    const SCALE = 0.5;

    type Ribbon = {
      /** Its lower edge: points the curve passes through, as shares of the width and height. */
      points: [number, number][];
      /** How it sways sideways: size (share of the height), waves per px along it, speed. */
      folds: { amp: number; k: number; speed: number; phase: number }[];
      /** Ray length (share of the height), brightness, shimmer speed and ray picture. */
      length: number;
      strength: number;
      shimmer: number;
      ray: HTMLCanvasElement;
      /** Runs away into the distance: its rays shrink towards its far end (at the horizon). */
      recedes?: boolean;
      /** How much wider its rays get where it runs straight up (along its rays, where they would stack into a thin
       *  line); 1: not at all. */
      widen?: number;
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastFrame = 0;
    /** Frames drawn since the rays' layer was last redrawn (it is redrawn every other frame). */
    let sinceRays = 0;
    let time = Math.random() * 100;
    let ribbons: Ribbon[] = [];
    /** The ray picture for rays low over the horizon (yellow-green). */
    let lowRay: HTMLCanvasElement | null = null;
    let stars: { x: number; y: number; size: number; phase: number }[] = [];
    let mountains = new Path2D();
    let farMountains = new Path2D();
    const layer = document.createElement('canvas');
    const lctx = layer.getContext('2d');
    const canBlur = 'filter' in ctx;

    /** Where the pointer is felt (eases in and out) and its x; a click's pulse (where, and how long ago in s). */
    let pointerX: number | null = null;
    let lean = 0;
    let leanX = 0;
    let pulse: { x: number; age: number } | null = null;

    /**
     * One ray: a soft column (fading to both sides), its lower edge at EDGE from the bottom, brightest there and fading
     * upwards, the colour changing with height (`stops`: [position from the bottom, r, g, b, alpha]).
     */
    const raySprite = (stops: [number, number, number, number, number][]) => {
      const sprite = document.createElement('canvas');
      sprite.width = 16;
      sprite.height = 256;
      const s = sprite.getContext('2d');
      if (!s) return sprite;
      const g = s.createLinearGradient(0, 256, 0, 0);
      for (const [at, r, gr, b, a] of stops) g.addColorStop(at, `rgba(${r},${gr},${b},${a})`);
      s.fillStyle = g;
      s.fillRect(0, 0, 16, 256);
      s.globalCompositeOperation = 'destination-in';
      const across = s.createLinearGradient(0, 0, 16, 0);
      across.addColorStop(0, 'rgba(0,0,0,0)');
      across.addColorStop(0.5, 'rgba(0,0,0,1)');
      across.addColorStop(1, 'rgba(0,0,0,0)');
      s.fillStyle = across;
      s.fillRect(0, 0, 16, 256);
      return sprite;
    };

    /**
     * The mountains' outline: [across the page, height above the horizon] (both as shares): low on the left, climbing
     * to a broad high plateau with a small bump right of the middle, down into a valley, then rising steeply off the
     * right edge.
     */
    const RIDGE: [number, number][] = [
      [0, 0.03],
      [0.1, 0.022],
      [0.21, 0.02],
      [0.29, 0.047],
      [0.37, 0.083],
      [0.43, 0.102],
      [0.49, 0.124],
      [0.57, 0.12],
      [0.63, 0.12],
      [0.655, 0.129],
      [0.7, 0.066],
      [0.76, 0.051],
      [0.81, 0.044],
      [0.855, 0.049],
      [0.875, 0.073],
      [0.92, 0.127],
      [0.96, 0.166],
      [1, 0.193],
    ];

    /**
     * The far range behind (lower, seen in the gaps and over the low parts of the near one): [across, height] as in
     * RIDGE.
     */
    const FAR_RIDGE: [number, number][] = [
      [0, 0.055],
      [0.08, 0.075],
      [0.16, 0.06],
      [0.27, 0.095],
      [0.36, 0.07],
      [0.47, 0.085],
      [0.6, 0.075],
      [0.72, 0.1],
      [0.8, 0.07],
      [0.88, 0.09],
      [1, 0.075],
    ];

    /** A ridge's height at `u` (0 to 1 across): straight slopes between its points, like a mountain's. */
    const lineHeight = (points: [number, number][], u: number) => {
      let i = 1;
      while (i < points.length - 1 && points[i][0] < u) i++;
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const t = Math.min(1, Math.max(0, (u - x0) / (x1 - x0 || 1)));
      return y0 + (y1 - y0) * t;
    };
    const ridgeHeight = (u: number) => lineHeight(RIDGE, u);

    /** Random numbers from a fixed seed, so the mountains look the same every time (and after a resize). */
    const seeded = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    /**
     * Rocky detail along a ridge at x (px), roughly -0.5 to 0.5: layers of jagged bumps, coarse to fine, each a
     * "ridged" pattern (sharp creases and peaks, not smooth waves). Every layer's bumps are fixed by `seed`.
     */
    const rock = (seed: number) => {
      const random = seeded(seed);
      const layers = [120, 55, 26, 12, 6].map((wavelength, k) => ({
        wavelength,
        weight: 0.55 ** k,
        values: Array.from({ length: 512 }, () => random()),
      }));
      const total = layers.reduce((n, l) => n + l.weight, 0);
      return (x: number) => {
        let sum = 0;
        for (const l of layers) {
          const at = Math.abs(x) / l.wavelength;
          const i = Math.floor(at);
          const f = at - i;
          const v = l.values[i % 512] + (l.values[(i + 1) % 512] - l.values[i % 512]) * f;
          sum += l.weight * (1 - Math.abs(2 * v - 1));
        }
        return sum / total - 0.5;
      };
    };

    const fold = (amp: number, k: number, speed: number) => ({ amp, k, speed, phase: Math.random() * Math.PI * 2 });

    /** The rays point away from this spot far below the page, so they stand almost straight up, fanning out a little. */
    const raySpot = () => ({ x: width * 0.5, y: height * 3 });

    /** A ribbon's edge as a dense line of points (px), smoothed through its points (Catmull-Rom). */
    const edgeLine = (r: Ribbon) => {
      const pts = r.points.map(([u, v]) => ({ x: u * width, y: v * height }));
      const line: { x: number; y: number }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < 16; k++) {
          const t = k / 16;
          const t2 = t * t;
          const t3 = t2 * t;
          line.push({
            x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
          });
        }
      }
      line.push(pts[pts.length - 1]);
      return line;
    };

    const build = () => {
      // Colours as in the photo: a deep green body (not a white-hot edge), violet at the tips.
      const green = raySprite([
        [0, 90, 255, 140, 0],
        [EDGE, 150, 255, 150, 0.7],
        [0.14, 60, 235, 120, 0.75],
        [0.4, 40, 210, 110, 0.42],
        [0.66, 60, 150, 165, 0.18],
        [0.85, 150, 80, 220, 0.14],
        [1, 190, 70, 230, 0],
      ]);
      const teal = raySprite([
        [0, 80, 240, 180, 0],
        [EDGE, 120, 255, 190, 0.6],
        [0.2, 50, 220, 150, 0.45],
        [0.6, 70, 140, 200, 0.18],
        [0.85, 160, 80, 220, 0.12],
        [1, 190, 70, 230, 0],
      ]);
      // Low over the horizon the light turns yellow-green.
      lowRay = raySprite([
        [0, 170, 255, 110, 0],
        [EDGE, 210, 255, 120, 0.72],
        [0.15, 150, 245, 90, 0.68],
        [0.4, 70, 220, 110, 0.4],
        [0.7, 60, 160, 160, 0.15],
        [1, 150, 80, 220, 0],
      ]);
      // Eight ribbons traced from sketches. Two great U's from the top of the sky down to the horizon and back up, one
      // inside the other; and six more running away into one point on the horizon behind the mountains.
      const meet: [number, number] = [0.488, 0.8];
      ribbons = [
        // The outer U: from the left edge, across under the cards, down to the middle and back up to the top.
        {
          points: [[-0.02, 0.17], [0.07, 0.21], [0.14, 0.29], [0.23, 0.39], [0.33, 0.4], [0.42, 0.47], [0.45, 0.56], [0.462, 0.66], [0.47, 0.74], [0.5, 0.775], [0.535, 0.7], [0.56, 0.58], [0.58, 0.43], [0.595, 0.24], [0.61, 0.08], [0.625, -0.02]],
          length: 0.36, strength: 0.75, shimmer: 1.2, ray: teal, widen: 3, folds: [fold(0.014, 0.008, -0.22), fold(0.006, 0.024, 0.35)],
        },
        // The inner, brighter U: from the top on the left, bulging out, down below the mountains and all the way up the
        // right side to the top corner.
        {
          points: [[0.142, -0.02], [0.183, 0.126], [0.19, 0.22], [0.15, 0.3], [0.137, 0.37], [0.152, 0.465], [0.215, 0.522], [0.309, 0.542], [0.366, 0.6], [0.418, 0.687], [0.47, 0.79], [0.52, 0.85], [0.555, 0.82], [0.575, 0.75], [0.617, 0.668], [0.664, 0.6], [0.743, 0.551], [0.831, 0.387], [0.88, 0.338], [0.92, 0.266], [0.942, 0.25], [0.947, 0.165], [0.957, 0.087], [1.01, 0.03]],
          length: 0.42, strength: 1, shimmer: 1, ray: green, folds: [fold(0.016, 0.007, 0.2), fold(0.007, 0.022, -0.32)],
        },
        // From the left edge, sloping down across the page to the meeting point.
        {
          points: [[-0.04, 0.43], [0.058, 0.487], [0.155, 0.546], [0.253, 0.624], [0.389, 0.721], meet],
          length: 0.42, strength: 0.7, shimmer: 1, ray: green, recedes: true, folds: [fold(0.014, 0.008, 0.2), fold(0.006, 0.024, -0.33)],
        },
        // Below it, also from the left edge, mostly behind the mountains near the end.
        {
          points: [[-0.03, 0.473], [0.058, 0.546], [0.194, 0.634], [0.282, 0.75], [0.389, 0.78], meet],
          length: 0.34, strength: 0.5, shimmer: 1.25, ray: teal, recedes: true, folds: [fold(0.012, 0.009, -0.24), fold(0.005, 0.027, 0.3)],
        },
        // From the right edge, curving down to the meeting point.
        {
          points: [[1.03, 0.443], [0.914, 0.497], [0.836, 0.575], [0.797, 0.663], [0.68, 0.741], [0.598, 0.78], meet],
          length: 0.4, strength: 0.65, shimmer: 1.1, ray: green, recedes: true, folds: [fold(0.014, 0.008, -0.2), fold(0.006, 0.025, 0.36)],
        },
        // From the top, left of the middle, winding down to the meeting point.
        {
          points: [[0.224, -0.03], [0.267, 0.06], [0.29, 0.16], [0.33, 0.27], [0.41, 0.38], [0.45, 0.47], [0.475, 0.6], [0.486, 0.7], meet],
          length: 0.38, strength: 0.7, shimmer: 0.9, ray: teal, recedes: true, folds: [fold(0.012, 0.009, 0.22), fold(0.005, 0.03, -0.3)],
        },
        // From the top-right corner, curving down through the right of the sky to the meeting point.
        {
          points: [[0.948, 0.017], [0.889, 0.106], [0.837, 0.164], [0.779, 0.227], [0.732, 0.28], [0.69, 0.348], [0.675, 0.426], [0.649, 0.484], [0.607, 0.561], [0.565, 0.619], [0.528, 0.677], [0.505, 0.75], meet],
          length: 0.4, strength: 0.7, shimmer: 1.05, ray: green, recedes: true, folds: [fold(0.013, 0.009, 0.21), fold(0.006, 0.026, -0.34)],
        },
        // From the top, nearer the middle, straight down to the meeting point.
        {
          points: [[0.321, -0.03], [0.418, 0.078], [0.447, 0.195], [0.476, 0.32], [0.496, 0.44], [0.505, 0.585], [0.502, 0.69], meet],
          length: 0.38, strength: 0.7, shimmer: 1.15, ray: green, recedes: true, widen: 3, folds: [fold(0.012, 0.01, -0.2), fold(0.005, 0.028, 0.34)],
        },
      ];

      const count = Math.round(Math.min(320, (width * height) / 4500));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height * HORIZON * 0.92,
        size: Math.random() < 0.85 ? 1 : 1.6,
        phase: Math.random() * Math.PI * 2,
      }));

      // Mountains: straight slopes through RIDGE's points with rocky detail (more on the taller parts), down to the
      // horizon; and a lower range behind, with detail of its own.
      const horizon = height * HORIZON;
      const near = rock(7);
      const far = rock(23);
      const ridge = new Path2D();
      const back = new Path2D();
      ridge.moveTo(0, horizon);
      back.moveTo(0, horizon);
      for (let x = 0; x <= width + 3; x += 3) {
        const u = x / Math.max(1, width);
        const base = ridgeHeight(u);
        ridge.lineTo(x, horizon - height * (base + near(x) * (0.012 + 0.09 * base)));
        const behind = lineHeight(FAR_RIDGE, u);
        back.lineTo(x, horizon - height * (behind + far(x) * (0.01 + 0.08 * behind)));
      }
      ridge.lineTo(width + 3, horizon);
      ridge.closePath();
      back.lineTo(width + 3, horizon);
      back.closePath();
      mountains = ridge;
      farMountains = back;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layer.width = Math.max(1, Math.round(width * SCALE));
      layer.height = Math.max(1, Math.round(height * SCALE));
      build();
      sinceRays = 0;
    };

    /** Brightness at a point along a ribbon (`along`: px along it, `x`: across the page). */
    const glow = (r: Ribbon, along: number, x: number) => {
      const patches = 0.5 + 0.5 * Math.sin(along * 0.0042 + time * 0.2 * r.shimmer + r.folds[0].phase) * Math.sin(along * 0.0019 - time * 0.12 + r.length * 20);
      const rays = 0.7 + 0.3 * Math.sin(along * 0.16 + time * 0.8 * r.shimmer + Math.sin(along * 0.027 + time * 0.35) * 3) * Math.sin(along * 0.061 - time * 0.5);
      const near = 1 + lean * 0.7 * Math.exp(-(((x - leanX) / 240) ** 2));
      let surge = 1;
      if (pulse) {
        const front = pulse.age * 520;
        surge += 1.5 * Math.exp(-pulse.age * 1.3) * Math.exp(-(((Math.abs(x - pulse.x) - front) / 100) ** 2));
      }
      return (0.15 + 0.85 * Math.max(0, patches)) * rays * near * surge * r.strength;
    };

    /** The rays, on the half-size layer. */
    const drawRays = () => {
      if (!lctx) return;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.globalCompositeOperation = 'lighter';
      const spot = raySpot();
      const horizon = height * HORIZON;
      for (const r of ribbons) {
        const line = edgeLine(r);
        const length = r.length * height;
        let total = 0;
        for (let i = 1; i < line.length; i++) total += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
        let along = 0;
        let carry = 0;
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          const seg = Math.hypot(b.x - a.x, b.y - a.y);
          if (seg === 0) continue;
          const nx = -(b.y - a.y) / seg;
          const ny = (b.x - a.x) / seg;
          // A ray every SPACING px along the edge.
          for (let d = SPACING - carry; d <= seg; d += SPACING) {
            along += SPACING;
            let sway = 0;
            for (const f of r.folds) sway += Math.sin(along * f.k + time * f.speed + f.phase) * f.amp;
            sway *= height;
            const x = a.x + ((b.x - a.x) * d) / seg + nx * sway;
            const y = a.y + ((b.y - a.y) * d) / seg + ny * sway;
            if (x < -80 || x > width + 80 || y > horizon + 4 || y < -length * 0.2) continue;
            const g = glow(r, along, x);
            if (g < 0.03) continue;
            const rx = x - spot.x;
            const ry = y - spot.y;
            const rl = Math.hypot(rx, ry) || 1;
            const sin = rx / rl;
            const cos = -ry / rl;
            // Where the edge runs the same way as the rays (the steep sides of the U), its rays pile up on each other:
            // shorter and dimmer there, so it stays green instead of burning out to white.
            const across = Math.abs(((b.x - a.x) / seg) * -cos - ((b.y - a.y) / seg) * sin);
            // Perspective: long rays close by (the ribbon's start), short ones far away (at the horizon), fading into
            // the glow where the ribbons meet.
            const near = r.recedes ? 1 - Math.min(1, along / Math.max(1, total)) : 1;
            const far = 0.12 + 0.88 * near ** 1.2;
            const h = length * (0.55 + 0.45 * Math.min(1, g)) * (0.6 + 0.4 * across) * far;
            const w = RAY_WIDTH * (0.45 + 0.75 * near) * (1 + ((r.widen ?? 1) - 1) * (1 - across));
            // A little brighter each, as there are fewer of them (SPACING).
            lctx.globalAlpha = Math.min(1, g * 0.52 * (0.55 + 0.45 * across) * Math.min(1, near * 12));
            // Rotated so the ray points away from the spot far below (almost straight up).
            lctx.setTransform(cos * SCALE, sin * SCALE, -sin * SCALE, cos * SCALE, x * SCALE, y * SCALE);
            lctx.drawImage(lowRay && y > height * (HORIZON - 0.2) ? lowRay : r.ray, -w / 2, -h * (1 - EDGE), w, h);
          }
          carry = (carry + seg) % SPACING;
        }
      }
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = 'source-over';
    };

    const drawSky = () => {
      const sky = ctx.createLinearGradient(0, 0, 0, height * HORIZON);
      sky.addColorStop(0, '#03040c');
      sky.addColorStop(0.6, '#061520');
      sky.addColorStop(1, '#0b2530');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      // The aurora lights up the whole sky a little: a broad green haze, strongest low in the middle.
      const ambient = ctx.createRadialGradient(width * 0.5, height * HORIZON, 0, width * 0.5, height * HORIZON, Math.max(width, height) * 0.95);
      ambient.addColorStop(0, 'rgba(50,190,120,0.26)');
      ambient.addColorStop(0.5, 'rgba(30,130,110,0.1)');
      ambient.addColorStop(1, 'rgba(30,130,110,0)');
      ctx.fillStyle = ambient;
      ctx.fillRect(0, 0, width, height * HORIZON);
      // A faint violet haze high on the left, as in the photo.
      const haze = ctx.createRadialGradient(width * 0.2, height * 0.12, 0, width * 0.2, height * 0.12, width * 0.45);
      haze.addColorStop(0, 'rgba(90,50,140,0.22)');
      haze.addColorStop(1, 'rgba(90,50,140,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
      // Where the ribbons meet far away, behind the mountains: a bright glow low over the horizon.
      // Centred just above the ridge, so its bright core shows over the mountains.
      const meetY = height * (HORIZON - ridgeHeight(0.488) - 0.01);
      const meet = ctx.createRadialGradient(width * 0.488, meetY, 0, width * 0.488, meetY, Math.max(width, height) * 0.45);
      meet.addColorStop(0, 'rgba(170,255,150,0.7)');
      meet.addColorStop(0.18, 'rgba(90,240,140,0.36)');
      meet.addColorStop(0.45, 'rgba(40,200,130,0.1)');
      meet.addColorStop(1, 'rgba(40,200,130,0)');
      ctx.fillStyle = meet;
      ctx.fillRect(0, 0, width, height * HORIZON);
      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        ctx.globalAlpha = 0.3 + 0.35 * Math.sin(time * 1.3 + s.phase);
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
    };

    /** The rays' layer over the sky (only the sky: nothing may light the lake but its reflection): blurred for the
     *  glow, then sharp for the rays. */
    const drawLights = () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height * HORIZON);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      // Mostly glow, a little sharpness: soft light, as in the photo, rather than neon edges.
      if (canBlur) {
        ctx.filter = 'blur(22px)';
        ctx.drawImage(layer, 0, 0, width, height);
        ctx.drawImage(layer, 0, 0, width, height);
        ctx.filter = 'none';
      }
      ctx.globalAlpha = canBlur ? 0.55 : 0.95;
      ctx.drawImage(layer, 0, 0, width, height);
      ctx.restore();
    };

    /**
     * Mountains, then the lake: dark water with everything above the horizon mirrored in it, row by row, each row
     * shifted a little sideways by slow waves that grow away from the shore (gentle ripples), then darkened with depth.
     */
    const drawLand = () => {
      const horizon = height * HORIZON;
      const depth = height - horizon;
      // The far range, just lighter than black so it shows behind the near one.
      ctx.fillStyle = '#070c14';
      ctx.fill(farMountains);
      ctx.fillStyle = '#000000';
      ctx.fill(mountains);
      if (depth > 1) {
        ctx.fillStyle = '#02060b';
        ctx.fillRect(0, horizon, width, depth);
        ctx.save();
        ctx.globalAlpha = 0.72;
        const strip = 2;
        for (let y = 0; y < depth; y += strip) {
          const rows = Math.min(strip, depth - y);
          const out = y / depth;
          const shift = Math.sin(y * 0.13 + time * 1.4) * (0.4 + out * 5) + Math.sin(y * 0.041 - time * 0.7) * out * 3;
          // The row `y` below the horizon mirrors the row `y` above it.
          const source = Math.max(0, horizon - y - rows);
          ctx.drawImage(canvas, 0, source * dpr, width * dpr, rows * dpr, shift, horizon + y, width, rows);
        }
        ctx.restore();
        const water = ctx.createLinearGradient(0, horizon, 0, height);
        water.addColorStop(0, 'rgba(3,8,14,0.15)');
        water.addColorStop(1, 'rgba(2,5,10,0.85)');
        ctx.fillStyle = water;
        ctx.fillRect(0, horizon, width, depth);
      }
    };

    const draw = () => {
      // The lights move slowly, so their rays (the costly part) are redrawn every other frame; the sky, glow, land
      // and lake are drawn every frame.
      if (sinceRays % 2 === 0) drawRays();
      sinceRays++;
      drawSky();
      drawLights();
      drawLand();
    };

    const step = (dt: number) => {
      time += dt;
      lean += ((pointerX === null ? 0 : 1) - lean) * (1 - Math.exp(-2.5 * dt));
      if (pointerX !== null) leanX += (pointerX - leanX) * (1 - Math.exp(-3 * dt));
      if (pulse) {
        pulse.age += dt;
        if (pulse.age > 3) pulse = null;
      }
    };

    const loop = (now: number) => {
      frame = 0;
      if (document.hidden || motionReduced()) {
        lastFrame = 0;
        return;
      }
      frame = requestAnimationFrame(loop);
      // A slow background: 30 frames a second is plenty, and halves the work on fast screens.
      if (lastFrame && now - lastFrame < FRAME_MS - 2) return;
      const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 1 / 60);
      lastFrame = now;
      step(dt);
      draw();
    };
    const start = () => {
      if (frame) return;
      if (motionReduced()) {
        draw();
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    resize();
    const sizes = new ResizeObserver(() => {
      resize();
      if (motionReduced()) draw();
    });
    sizes.observe(canvas);

    const inside = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
    };
    const onMove = (event: PointerEvent) => {
      const p = inside(event);
      if (p && pointerX === null) leanX = p.x;
      pointerX = p ? p.x : null;
    };
    const onLeave = () => {
      pointerX = null;
    };
    const onClick = (event: MouseEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      const p = inside(event);
      if (event.button !== 0 || !p) return;
      if (el?.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [contenteditable="true"], .home-card')) return;
      pulse = { x: p.x, age: 0 };
    };
    const onVisible = () => {
      if (!document.hidden) start();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick);
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisible);
    start();

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
