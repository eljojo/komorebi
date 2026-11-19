import type { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { registerAccountPages } from './account';
import { registerFrontPages } from './front';
import { registerLineagePages } from './lineage';
import { registerPlaylistPages } from './playlists';
import { registerPresetPages } from './presets';
import { registerRemotePages } from './remote';

export function registerPages(app: Hono<AppEnv>) {
  registerFrontPages(app);
  registerPresetPages(app);
  registerPlaylistPages(app);
  registerAccountPages(app);
  registerRemotePages(app);
  registerLineagePages(app);
}
