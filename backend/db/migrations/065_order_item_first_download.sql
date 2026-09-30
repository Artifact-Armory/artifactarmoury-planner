-- 065_order_item_first_download.sql
--
-- Record when a buyer first downloaded each purchased item.
--
-- Evidence that "performance began" for the digital-content cancellation
-- exemption (UK CCRs 2013 reg. 37 / EU CRD art. 16(m)). This is NOT the consent
-- itself — that is orders.download_consent_at, captured at checkout. It lets an
-- admin see, per line, whether a refund request is for a file the buyer already
-- took. Set once, on the first download, and never overwritten.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS first_downloaded_at TIMESTAMP;
