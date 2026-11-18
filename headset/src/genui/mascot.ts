import { COLORS, MASCOT_NAME } from './brand';

/**
 * Muse, the app's mascot, as a flat sticker: a small white creature with big eyes, drawn here as SVG (our own
 * design). The logo is drawn from it (scripts/render-brand.mjs reads public/ui/muse.svg, written by
 * `node scripts/write-muse.mjs`), and the headset dashboard keeps it, invisible, as the place Muse stands and the
 * target a pinch hits. The Muse that moves is the 3D one (muse3d.ts).
 */

const BODY = 'M44 204 C22 204 14 184 14 142 C14 74 50 36 100 36 C150 36 186 74 186 142 C186 184 178 204 156 204 Z';

/**
 * Muse as SVG. `look` moves the pupils (each from -1 to 1); `open` gives the open, happy mouth. The mouth that is
 * not shown is hidden in the drawing itself, so it is right as a plain picture too (the page's CSS decides there).
 */
export function mascotSvg(look: { x: number; y: number } = { x: 0, y: 0 }, open = false): string {
  const { ink, muse, paper, sky } = COLORS;
  const px = Math.max(-1, Math.min(1, look.x)) * 8;
  const py = Math.max(-1, Math.min(1, look.y)) * 7;
  // width and height give the picture its size where it is drawn as an image (the headset dashboard).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -20 232 250" width="464" height="500" role="img" aria-label="${MASCOT_NAME}">
  <g class="muse-all">
    <path d="${BODY}" fill="${paper}" stroke="${paper}" stroke-width="24" stroke-linejoin="round"/>
    <g class="muse-arm"><path d="M30 150 C12 150 2 138 4 124" fill="none" stroke="${paper}" stroke-width="30" stroke-linecap="round"/>
      <path d="M30 150 C12 150 2 138 4 124" fill="none" stroke="${ink}" stroke-width="20" stroke-linecap="round"/>
      <path d="M30 150 C12 150 2 138 4 124" fill="none" stroke="${muse}" stroke-width="10" stroke-linecap="round"/></g>
    <path d="M170 150 C188 150 198 162 196 176" fill="none" stroke="${ink}" stroke-width="20" stroke-linecap="round"/>
    <path d="M170 150 C188 150 198 162 196 176" fill="none" stroke="${muse}" stroke-width="10" stroke-linecap="round"/>
    <path d="${BODY}" fill="${muse}" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M52 176 C70 190 130 190 148 176" fill="none" stroke="${sky}" stroke-width="10" stroke-linecap="round"/>
    <g class="muse-eyes">
      <ellipse cx="70" cy="118" rx="22" ry="26" fill="${paper}" stroke="${ink}" stroke-width="6"/>
      <ellipse cx="130" cy="118" rx="22" ry="26" fill="${paper}" stroke="${ink}" stroke-width="6"/>
      <g class="muse-pupils" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">
        <circle cx="70" cy="120" r="10" fill="${ink}"/><circle cx="130" cy="120" r="10" fill="${ink}"/>
        <circle cx="74" cy="115" r="3.5" fill="${paper}"/><circle cx="134" cy="115" r="3.5" fill="${paper}"/>
      </g>
    </g>
    <path class="muse-smile" d="M86 160 C94 170 106 170 114 160" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"${open ? ' display="none"' : ''}/>
    <path class="muse-open" d="M84 158 C88 180 112 180 116 158 Z" fill="${ink}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"${open ? '' : ' display="none"'}/>
  </g>
</svg>`;
}
