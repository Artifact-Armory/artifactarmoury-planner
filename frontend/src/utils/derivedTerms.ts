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

/** The taxonomy facet that duplicates the Usage licence select. */
export const LICENCE_FACET = 'licence'

// models.license is a two-value CHECK constraint (migration 030) and its text is
// what buyers are actually granted, so it is authoritative. The facet's other four
// terms (Commercial Display, Free, CC0/CC-BY, Subscription) are not offered — add
// them to the select AND widen the constraint if they're ever wanted, rather than
// letting a tag claim rights the licence column doesn't grant.
const LICENSE_TO_TERM: Record<string, string> = {
  personal: 'licence:personal-use',
  commercial: 'licence:merchant-licence-physical-sales',
}

/**
 * Replace any licence token in `terms` with the one implied by the Usage licence
 * select, so the tag can never contradict the column the product page reads.
 */
export function withLicenceTerm(terms: string[], license: string): string[] {
  const kept = terms.filter((t) => !t.startsWith(`${LICENCE_FACET}:`))
  const token = LICENSE_TO_TERM[license]
  return token ? [...kept, token] : kept
}

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
