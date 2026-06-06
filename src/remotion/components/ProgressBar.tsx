/**
 * PERSISTENT progress bar: advances linearly from 0 to 1
 * over the total duration (current frame / duration). Placed at the bottom of the frame.
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
        bottom: 72,
        left: 64,
        right: 64,
        height: 10,
        borderRadius: 999,
        background: theme.surface,
        overflow: 'hidden',
        border: `1px solid ${theme.accentSoft}`,
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: '100%',
          borderRadius: 999,
          background: `linear-gradient(90deg, ${theme.accentSoft}, ${theme.accent})`,
          boxShadow: `0 0 24px ${theme.accent}`,
        }}
      />
    </div>
  );
}
