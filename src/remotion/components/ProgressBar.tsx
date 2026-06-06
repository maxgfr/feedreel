/**
 * PERSISTENT progress bar: advances linearly from 0 to 1 over the total
 * duration. Thicker, solid accent fill (bold sport-social). Bottom of frame.
 */
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../theme';

interface ProgressBarProps {
  theme: Theme;
}

export function ProgressBar({ theme }: ProgressBarProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Bound the denominator to avoid any division by zero.
  const total = Math.max(1, durationInFrames - 1);
  const progress = interpolate(frame, [0, total], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 66,
        left: 64,
        right: 64,
        height: 16,
        borderRadius: 999,
        background: theme.surface,
        border: `2px solid ${theme.accentSoft}`,
      }}
    >
      {/* Filled portion (gradient). */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${progress * 100}%`,
          borderRadius: 999,
          background: theme.accentGradient,
          boxShadow: `0 0 28px ${theme.accentGlow}`,
        }}
      />
      {/* Glowing leading dot at the progress edge. */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${progress * 100}%`,
          width: 26,
          height: 26,
          marginLeft: -13,
          marginTop: -13,
          borderRadius: 999,
          background: theme.accentBright,
          boxShadow: `0 0 24px ${theme.accentBright}`,
        }}
      />
    </div>
  );
}
