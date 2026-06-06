/**
 * Procedural backdrop: dark background + accent halo + fine grid + grain.
 * 100% code, no external image. Stacked as `AbsoluteFill` layers.
 */
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { Theme } from '../theme';

interface BackgroundProps {
  theme: Theme;
}

export function Background({ theme }: BackgroundProps): React.ReactElement {
  const frame = useCurrentFrame();

  // Very slow breathing of the halo to avoid a static image.
  const haloOpacity = interpolate(
    Math.sin(frame / 60),
    [-1, 1],
    [0.75, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background }}>
      {/* Accent halo. */}
      <AbsoluteFill style={{ background: theme.halo, opacity: haloOpacity }} />

      {/* Fine grid. */}
      <AbsoluteFill
        style={{
          backgroundImage: theme.grid,
          backgroundSize: theme.gridSize,
          maskImage:
            'radial-gradient(120% 100% at 50% 30%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 80%)',
          WebkitMaskImage:
            'radial-gradient(120% 100% at 50% 30%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 80%)',
        }}
      />

      {/* Procedural grain. */}
      <AbsoluteFill
        style={{
          backgroundImage: theme.grain,
          backgroundRepeat: 'repeat',
          opacity: 0.05,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Vignette to anchor the edges. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(130% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  );
}
