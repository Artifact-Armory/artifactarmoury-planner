import React, { useState } from 'react'
import { Mail, Paperclip, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { contactApi, ContactAttachmentInput } from '../api/endpoints/contact'
import { SITE_NAME, SITE_DOMAIN } from '../config/brand'

const SUPPORT_EMAIL = `support@${SITE_DOMAIN}`

const MAX_FILES = 5
const MAX_MB = 25
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.txt'

const Contact: React.FC = () => {
  const { user } = useAuthStore()

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const tooBig = incoming.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (tooBig) {
      setError(`"${tooBig.name}" is over ${MAX_MB}MB`)
      return
    }
    setError(null)
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !subject.trim() || message.trim().length < 10) {
      setError(message.trim().length > 0 && message.trim().length < 10
        ? 'Message must be at least 10 characters'
        : 'Please fill in every field')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      let attachments: ContactAttachmentInput[] = []
      if (files.length > 0) {
        setUploading(true)
        attachments = await Promise.all(files.map((f) => contactApi.uploadAttachment(f)))
        setUploading(false)
      }
      await contactApi.submit({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
        attachments,
      })
      setSent(true)
      toast.success("Message sent — we'll get back to you soon.")
    } catch (err: any) {
      setUploading(false)
      setError(err?.response?.data?.message || err?.message || 'Failed to send your message')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 size={28} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Message sent</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Thanks, {name.trim() || 'there'} — we've emailed a confirmation to {email.trim()}.
          Our support team usually replies within a day or two.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => setSent(false)}>
          Send another message
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm font-medium text-primary">Support</p>
      <h1 className="mt-2 text-3xl font-semibold text-foreground">Contact us</h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Question about an order, a problem with a download, or feedback for {SITE_NAME}? Send us
        a message below — you can attach photos, screenshots, or files if it helps us understand
        the issue. You can also email us directly at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            required
            maxLength={200}
          />
          <Input
            label="Your email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            maxLength={255}
          />
        </div>

        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What's this about?"
          required
          maxLength={200}
        />

        <div className="space-y-1.5">
          <label htmlFor="contact-message" className="text-sm font-medium text-foreground">
            Message
          </label>
          <textarea
            id="contact-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Tell us what's going on…"
            required
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary/50 focus:outline-hidden focus:ring-1 focus:ring-primary/50"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">
            Attachments <span className="ml-1 text-xs font-normal text-muted-foreground">optional, up to {MAX_FILES} files, {MAX_MB}MB each</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary">
            <Paperclip size={16} />
            Add files for review
            <input type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded-sm bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle size={16} /> {error}
          </p>
        )}

        <Button
          type="submit"
          loading={submitting}
          className="w-full sm:w-auto"
          leftIcon={<Mail size={16} />}
        >
          {uploading ? 'Uploading attachments…' : submitting ? 'Sending…' : 'Send message'}
        </Button>
      </form>
    </div>
  )
}

export default Contact
