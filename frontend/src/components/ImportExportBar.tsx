import { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ImportResult } from '../api/types';
import './ImportExportBar.scss';

interface Props {
  exportPath: string;
  exportFilename: string;
  importPath: string;
  canImport: boolean;
  /** Called after a successful import so the parent can reload data. */
  onImported: () => void;
}

export function ImportExportBar({ exportPath, exportFilename, importPath, canImport, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doExport() {
    setError(null);
    setBusy(true);
    try {
      await api.download(exportPath, exportFilename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await api.upload<ImportResult>(importPath, file);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="iebar">
      <div className="iebar__buttons">
        <button className="btn btn--sm" onClick={doExport} disabled={busy}>
          ⬇ Export Excel
        </button>
        {canImport && (
          <>
            <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              ⬆ Import Excel
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={onFile}
            />
          </>
        )}
      </div>

      {error && <p className="error-text iebar__msg">{error}</p>}

      {result && (
        <div className="iebar__result">
          <span className="badge badge--actual">เพิ่ม {result.created}</span>
          {result.updated > 0 && <span className="badge badge--budget">อัปเดต {result.updated}</span>}
          {result.skipped > 0 && <span className="badge badge--adjust">ข้าม {result.skipped}</span>}
          {result.errors.length > 0 && (
            <ul className="iebar__errors error-text">
              {result.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
