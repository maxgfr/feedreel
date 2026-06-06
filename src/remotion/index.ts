/**
 * Remotion entry point (consumed by `@remotion/bundler`).
 * Registers the root that declares the `FeedReelVideo` composition.
 */
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
