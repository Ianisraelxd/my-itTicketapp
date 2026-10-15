-- Password policy, forced password change and progressive lockout. Run once on an existing database
-- (the server does this at startup). One change per statement: some cloud databases need that.
ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN lock_level TINYINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_failed_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;

-- The last few password hashes of each person, so a password cannot be reused.
CREATE TABLE IF NOT EXISTS password_history (
  history_pk    INT AUTO_INCREMENT PRIMARY KEY,
  user_pk       INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pwhist_user (user_pk, history_pk),
  CONSTRAINT fk_pwhist_user FOREIGN KEY (user_pk) REFERENCES users(user_pk) ON DELETE CASCADE
);
