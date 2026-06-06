/**
 * Bold, layered backdrop: depth gradient base, a breathing accent glow (top) and
 * a softer drifting counter-glow, faint diagonal "field lines", a subtle grain,
 * and a vignette to anchor the edges. All procedural — no images.
 */
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { Theme } from '../theme';

interface BackgroundProps {
  theme: Theme;
}

export function Background({ theme }: BackgroundProps): React.ReactElement {
  const frame = useCurrentFrame();

  // Slow breathing of the top glow to avoid a static frame.
  const glow = interpolate(Math.sin(frame / 55), [-1, 1], [0.75, 1]);
  // Gentle horizontal drift of the bottom counter-glow.
  const drift = interpolate(Math.sin(frame / 90), [-1, 1], [-6, 6]);

  return (
    <AbsoluteFill style={{ background: theme.pageGradient }}>
      {/* Faint diagonal field lines for texture. */}
      <AbsoluteFill
        style={{
          backgroundImage: `repeating-linear-gradient(115deg, ${theme.accentSoft} 0px, ${theme.accentSoft} 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 130px)`,
          opacity: 0.5,
          maskImage: 'radial-gradient(140% 90% at 50% 30%, #000 30%, rgba(0,0,0,0) 80%)',
          WebkitMaskImage: 'radial-gradient(140% 90% at 50% 30%, #000 30%, rgba(0,0,0,0) 80%)',
        }}
      />
      {/* Strong accent glow at the top (breathing). */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(95% 60% at 50% -8%, ${theme.accentGlow} 0%, rgba(0,0,0,0) 60%)`,
          opacity: glow,
        }}
      />
      {/* Soft counter-glow, bottom (drifting). */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 50% at ${80 + drift}% 108%, ${theme.accentSoft} 0%, rgba(0,0,0,0) 55%)`,
        }}
      />
      {/* Procedural grain. */}
      <AbsoluteFill style={{ backgroundImage: theme.grain, backgroundSize: '160px 160px', opacity: 0.04 }} />
      {/* Vignette to anchor the edges. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(135% 95% at 50% 45%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.62) 100%)',
        }}
      />
    </AbsoluteFill>
  );
}
