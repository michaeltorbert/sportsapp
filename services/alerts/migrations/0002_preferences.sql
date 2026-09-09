-- Additive: subscriptions and all attempt/event history remain intact.
CREATE TABLE subscription_settings (
  subscription_id TEXT PRIMARY KEY,
  close_game INTEGER NOT NULL DEFAULT 1 CHECK(close_game IN (0,1)),
  upset_watch INTEGER NOT NULL DEFAULT 1 CHECK(upset_watch IN (0,1)),
  upset_final INTEGER NOT NULL DEFAULT 1 CHECK(upset_final IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  close_since INTEGER NOT NULL DEFAULT 0,
  upset_since INTEGER NOT NULL DEFAULT 0,
  final_since INTEGER NOT NULL DEFAULT 0,
  kickoff_since INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0
);
INSERT INTO subscription_settings(subscription_id) SELECT id FROM subscriptions;
-- Old clients/compatible writers retain their former implicit choices. The new
-- enrollment API overwrites these defaults atomically in its registration batch.
CREATE TRIGGER subscription_settings_insert AFTER INSERT ON subscriptions BEGIN
  INSERT OR IGNORE INTO subscription_settings(subscription_id) VALUES(new.id);
END;
CREATE TABLE alert_suppressions (
  subscription_id TEXT NOT NULL, game_id TEXT NOT NULL, trigger TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(subscription_id,game_id,trigger)
);
CREATE TABLE rule_baselines (
  game_id TEXT NOT NULL, trigger TEXT NOT NULL, observed_at INTEGER NOT NULL,
  PRIMARY KEY(game_id,trigger)
);
CREATE INDEX deliveries_recipient ON deliveries(subscription_id,event_id);
INSERT OR IGNORE INTO poll_state(id,value) VALUES('preferences_epoch',0);
-- Delivery remains paused until the documented compatible-worker drain. Never
-- infer safe cutover from schema migration or a poll lock lease alone.
INSERT OR IGNORE INTO poll_state(id,value) VALUES('preferences_delivery_enabled',0);
