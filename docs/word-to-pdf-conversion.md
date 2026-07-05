# Word to PDF Conversion

UnimiDoc accepts Word files only as a convenience format. PDF remains the recommended upload format because it is already fixed-layout and is easier to validate, preview, watermark, compress, and protect.

## Default Converter

Use LibreOffice headless on the backend:

```bash
soffice --headless --convert-to pdf:writer_pdf_Export --outdir /safe/output /safe/input.docx
```

The implementation lives in `server/pdf-pipeline/word-to-pdf.ts` and supports:

- `.docx` ZIP magic-byte validation;
- legacy `.doc` OLE magic-byte validation;
- isolated LibreOffice user profile per conversion;
- conversion timeout;
- PDF magic-byte verification;
- optional `qpdf --check`;
- SHA-256 tracking for source and converted PDF.

Set `LIBREOFFICE_BIN` when the binary is not available as `soffice`, for example:

```bash
LIBREOFFICE_BIN=/Applications/LibreOffice.app/Contents/MacOS/soffice
```

## User Warning

The upload UI must warn users that Word conversion can slightly alter layout, especially with custom fonts, tables, comments, tracked changes, fields, image anchoring, and page breaks. The generated PDF must be reviewed before publication. UnimiDoc does not guarantee perfect Word layout fidelity and does not take responsibility for conversion artifacts.

## In-Browser Fallback (zero-cost)

When the backend LibreOffice pipeline is not available, `src/lib/wordToPdf.ts`
converts `.docx` entirely in the browser via mammoth + pdf-lib. As of the latest
revision it preserves, beyond text and structure:

- **images** — mammoth inlines them as base64 data URIs; PNG/JPEG are embedded
  into the PDF (Word EMF/WMF vector images are skipped, pdf-lib can't embed them);
- **tables** — parsed from mammoth's `<table>` output and drawn as a real
  bordered grid (header row shaded), breaking across pages row-by-row.

Still approximated: exact fonts, multi-column layouts, floats, precise image
anchoring. For publication-grade fidelity prefer the LibreOffice path or upload
a PDF directly. This tradeoff is surfaced to the user in the upload UI.

## Why Not Cloud Conversion By Default

Microsoft Graph can convert Office documents to PDF, and it may be a future optional high-fidelity path. It is not the default because it sends user documents to an external cloud service, adds licensing and privacy complexity, and is harder to run cost-first.
