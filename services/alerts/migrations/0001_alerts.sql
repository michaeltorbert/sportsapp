CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  token_hash TEXT NOT NULL, kickoff INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX subscriptions_active ON subscriptions(active, id);
CREATE TABLE game_states (game_id TEXT PRIMARY KEY, game_day TEXT NOT NULL, state_json TEXT NOT NULL, observed_at INTEGER NOT NULL);
CREATE TABLE alert_events (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, trigger TEXT NOT NULL, game_day TEXT NOT NULL,
  created_at INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(game_id, trigger)
);
CREATE INDEX alert_events_recent ON alert_events(created_at);
CREATE TABLE deliveries (
  event_id TEXT NOT NULL, subscription_id TEXT NOT NULL, status TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, PRIMARY KEY(event_id, subscription_id)
);
CREATE TABLE poll_state (id TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE poll_lock (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
