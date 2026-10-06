-- Run once in the AllBlue database before deploying the new server.
-- Additive change only; does not change existing users or remove guest data.
ALTER TABLE `user`
  ADD COLUMN is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN temporary_owner_id INT NULL,
  ADD INDEX idx_user_temporary_owner (temporary_owner_id, is_temporary),
  ADD CONSTRAINT fk_user_temporary_owner FOREIGN KEY (temporary_owner_id)
    REFERENCES `user` (id) ON DELETE SET NULL ON UPDATE CASCADE;
