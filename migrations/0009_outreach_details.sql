-- What each lead was sent: the robot's answers to extra questions, and which version of the campaign message.
ALTER TABLE outreach ADD COLUMN answers TEXT;
ALTER TABLE outreach ADD COLUMN msg_version INTEGER;
ALTER TABLE campaigns ADD COLUMN msg_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN start_at INTEGER;          -- scheduled start (ms); NULL = as soon as it's active
CREATE TABLE IF NOT EXISTS campaign_messages (
  campaign_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, version)
);
