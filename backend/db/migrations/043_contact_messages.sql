-- 043_contact_messages.sql
--
-- Public "Contact us" page (frontend/src/pages/Contact.tsx). Anyone — signed in
-- or not — can send a message to support with an optional set of file
-- attachments (screenshots of a bug, proof of an issue, etc.). The message is
-- persisted here BEFORE the notification email goes out, so a message is never
-- lost just because RESEND_API_KEY is unset locally or Resend has a bad day
-- (services/email.ts's sendEmail() logs and swallows failures by design — see
-- routes/contact.ts).

CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for an anonymous sender
    name    VARCHAR(200) NOT NULL,
    email   VARCHAR(255) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user ON contact_messages(user_id);

CREATE TABLE IF NOT EXISTS contact_message_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_message_id UUID NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    file_path    VARCHAR(500) NOT NULL,
    file_name    VARCHAR(255),
    content_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contact_message_attachments_message ON contact_message_attachments(contact_message_id);

COMMENT ON TABLE contact_messages IS 'Submissions from the public Contact page; also emailed to support@artifactarmoury.com.';
COMMENT ON TABLE contact_message_attachments IS 'Files a contact-form sender attached for review, uploaded to R2 under the contact/ prefix.';
