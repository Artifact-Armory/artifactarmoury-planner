// frontend/src/utils/derivedTerms.ts
//
// Some taxonomy facets ask the SAME question as a dedicated field on the artist
// upload/edit form, which meant artists answered it twice in two vocabularies.
// The dedicated field is authoritative (it writes a real column that the product
// page reads); the taxonomy term exists so browse can filter on it.
//
// So: hide the duplicated terms from the picker (TermPicker's excludeTermPaths)
// and derive the token from the dedicated field instead. That keeps browse
// filtering AND the publish-time required-facet guardrail
// (services/modelTerms.ts assertRequiredTermsPresent) working, while asking the
// artist only once.
//
// Paths must match what seed-taxonomy.ts produced from src/data/taxonomy.ts via
// slugify(): '&' becomes ' and ', so 'FDM & Resin' → 'fdm-and-resin'.

/** The `print-files` group whose three terms duplicate the Printer type select. */
export const PRINT_PROCESS_PATH = 'print-files:process'

const PRINTER_TYPE_TO_TERM: Record<string, string> = {
  fdm: 'print-files:process/fdm-optimised',
  resin: 'print-files:process/resin-optimised',
  both: 'print-files:process/fdm-and-resin',
}

/**
 * Replace any print-process token in `terms` with the one implied by the
 * dedicated Printer type select. An empty `printerType` ("Not specified") just
 * clears it — the Print & Files facet stays satisfiable via its other groups
 * (Supports / Bed Size / Files / Assurance), which remain visible in the picker.
 */
export function withPrinterTypeTerm(terms: string[], printerType: string): string[] {
  const kept = terms.filter((t) => !t.startsWith(`${PRINT_PROCESS_PATH}/`) && t !== PRINT_PROCESS_PATH)
  const token = PRINTER_TYPE_TO_TERM[printerType]
  return token ? [...kept, token] : kept
}
