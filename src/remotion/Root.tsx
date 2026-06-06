/**
 * Remotion root: declares the single parametric composition `FeedReelVideo`.
 *
 * Default format: 1080×1920 @ 30 fps, 300-frame duration (recomputed by
 * `calculateFeedReelMetadata` from the segments' audio durations).
 */
import { Composition } from 'remotion';
import {
  FeedReelVideo,
  calculateFeedReelMetadata,
  defaultFeedReelProps,
} from './FeedReelVideo';

export function RemotionRoot(): React.ReactElement {
  return (
    <Composition
      id="FeedReelVideo"
      component={FeedReelVideo}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultFeedReelProps}
      calculateMetadata={calculateFeedReelMetadata}
    />
  );
}
