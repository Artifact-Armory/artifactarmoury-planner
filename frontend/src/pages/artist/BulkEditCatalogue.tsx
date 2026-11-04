import React from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Loader2, Upload } from 'lucide-react'
import { catalogueApi, CataloguePreview } from '../../api/endpoints/catalogue'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  price: 'Price',
  description: 'Description',
  licence: 'Licence',
  printer_type: 'Printer type',
  show_in_planner: 'Show in planner',
}

function errMessage(err: unknown, fallback: string): string {
  const anyErr = err as any
  return anyErr?.response?.data?.message || anyErr?.message || fallback
}

/**
 * Bulk edit by CSV: download every listing, change it in Excel/Sheets, upload,
 * check the preview, then apply. Nothing is saved before "Apply".
 */
export default function BulkEditCatalogue() {
  const [downloading, setDownloading] = React.useState(false)
  const [csv, setCsv] = React.useState<string | null>(null)
  const [fileName, setFileName] = React.useState('')
  const [preview, setPreview] = React.useState<CataloguePreview | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      await catalogueApi.downloadCsv()
    } catch (err) {
      setError(errMessage(err, 'Could not download your catalogue'))
    } finally {
      setDownloading(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setDone(null)
    setPreview(null)
    setFileName(file.name)
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Save the spreadsheet as CSV first (in Excel: File > Save As > CSV UTF-8).')
      return
    }
    setChecking(true)
    try {
      const text = await file.text()
      setCsv(text)
      setPreview(await catalogueApi.preview(text))
    } catch (err) {
      setError(errMessage(err, 'Could not read that file'))
    } finally {
      setChecking(false)
    }
  }

  async function apply() {
    if (!csv) return
    setApplying(true)
    setError(null)
    try {
      const result = await catalogueApi.apply(csv)
      setDone(result.message)
      setPreview(null)
      setCsv(null)
    } catch (err) {
      const data = (err as any)?.response?.data
      if (data?.errors) setPreview(data)
      setError(errMessage(err, 'Could not apply the changes'))
    } finally {
      setApplying(false)
    }
  }

  const canApply = !!preview && preview.errors.length === 0 && preview.changed.length > 0

  return (
    <div className="px-4 py-10 max-w-4xl mx-auto">
      <Link to="/artist/models" className="text-sm text-muted-foreground hover:underline">
        ← My Models
      </Link>
      <h1 className="text-xl font-semibold mt-2">Bulk edit by CSV</h1>
      <p className="text-muted-foreground mt-1">
        Change many listings at once, for example every price, in Excel or Google Sheets.
      </p>

      <ol className="mt-6 space-y-6">
        <li className="border rounded-sm p-4">
          <p className="font-medium">1. Download your catalogue</p>
          <p className="text-sm text-muted-foreground mt-1">
            One row per listing. You can change <b>name</b>, <b>price</b>, <b>description</b>, <b>licence</b> (personal or
            commercial), <b>printer_type</b> (fdm, resin, both or empty) and <b>show_in_planner</b> (yes or no). Don't change
            the <b>id</b> column. Status, category and link are there for reference and are not changed. You can delete rows
            or columns you don't want to touch.
          </p>
          <button
            onClick={download}
            disabled={downloading}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-sm border text-sm disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download CSV
          </button>
        </li>

        <li className="border rounded-sm p-4">
          <p className="font-medium">2. Upload the edited file</p>
          <p className="text-sm text-muted-foreground mt-1">
            Save it as CSV (in Excel: CSV UTF-8). You'll see every change before anything is saved.
          </p>
          <input ref={fileInput} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={onFile} />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={checking || applying}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-sm border text-sm disabled:opacity-60"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {fileName ? 'Choose another file' : 'Choose CSV file'}
          </button>
          {fileName && <span className="ml-3 text-sm text-muted-foreground">{fileName}</span>}
        </li>
      </ol>

      {error && (
        <div className="mt-6 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {done && (
        <div className="mt-6 flex items-start gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{done}</span>
        </div>
      )}

      {preview && (
        <div className="mt-8">
          <h2 className="font-semibold">3. Check the changes</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {preview.rowsRead} row{preview.rowsRead === 1 ? '' : 's'} read: {preview.changed.length} to change,{' '}
            {preview.unchanged} unchanged{preview.errors.length ? `, ${preview.errors.length} problem${preview.errors.length === 1 ? '' : 's'}` : ''}.
            {preview.ignoredColumns.length > 0 && ` Ignored columns: ${preview.ignoredColumns.join(', ')}.`}
          </p>

          {preview.errors.length > 0 && (
            <div className="mt-4 border border-destructive/50 rounded-sm p-3">
              <p className="text-sm font-medium text-destructive">Fix these in the file and upload it again. Nothing has been changed.</p>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.errors.slice(0, 200).map((e, i) => (
                  <li key={i}>Row {e.line}: {e.message}</li>
                ))}
                {preview.errors.length > 200 && <li>…and {preview.errors.length - 200} more.</li>}
              </ul>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="mt-4 border border-amber-500/50 rounded-sm p-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Worth a second look
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.warnings.slice(0, 200).map((w, i) => (
                  <li key={i}>Row {w.line}: {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.changed.length > 0 && (
            <div className="mt-4 border rounded-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Row</th>
                    <th className="p-2">Listing</th>
                    <th className="p-2">Field</th>
                    <th className="p-2">Now</th>
                    <th className="p-2">New</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changed.flatMap((row) =>
                    row.changes.map((c, i) => (
                      <tr key={`${row.id}-${c.field}`} className="border-t align-top">
                        <td className="p-2 text-muted-foreground">{i === 0 ? row.line : ''}</td>
                        <td className="p-2">{i === 0 ? row.name : ''}</td>
                        <td className="p-2">{FIELD_LABELS[c.field] ?? c.field}</td>
                        <td className="p-2 text-muted-foreground break-words max-w-[14rem]">{c.from || '(empty)'}</td>
                        <td className="p-2 font-medium break-words max-w-[14rem]">{c.to || '(empty)'}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={apply}
              disabled={!canApply || applying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-primary text-primary-foreground disabled:opacity-50"
            >
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply {preview.changed.length} change{preview.changed.length === 1 ? '' : 's'}
            </button>
            {preview.changed.length === 0 && preview.errors.length === 0 && (
              <span className="text-sm text-muted-foreground">Nothing in this file differs from your listings.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
