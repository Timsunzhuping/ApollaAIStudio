import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Surface } from '@apolla/contracts';
import { Card, Field, ErrorMsg } from '../components/ui';

export function Surfaces() {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [id, setId] = useState('');
  const [text, setText] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [params, setParams] = useState('{"targetLang":"English"}');
  const [outputPath, setOutputPath] = useState('');
  const [result, setResult] = useState<{ path: string; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.surfaces().then((s) => { setSurfaces(s); setId(s[0]?.id ?? ''); }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const surface = surfaces.find((s) => s.id === id);

  const run = async () => {
    if (!surface) return;
    setError(null);
    setResult(null);
    setBusy(true);
    let parsed: Record<string, unknown> = {};
    if (params.trim()) {
      try { parsed = JSON.parse(params); } catch { setError('params must be valid JSON'); setBusy(false); return; }
    }
    try {
      const body = surface.inputKind === 'doc'
        ? { surfaceId: id, sourcePath, params: parsed, outputPath: outputPath || undefined }
        : { surfaceId: id, text, params: parsed, outputPath: outputPath || undefined };
      setResult(await api.runSurface(body));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'surface failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col">
      <Card title="Surfaces — Translate · Sheets · Meeting Notes">
        <div className="row">
          <Field label="Surface">
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {surfaces.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
            </select>
          </Field>
          <Field label="Params (JSON)">
            <input value={params} onChange={(e) => setParams(e.target.value)} />
          </Field>
          <Field label="Output path (optional)">
            <input value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="auto" />
          </Field>
        </div>
        {surface?.inputKind === 'doc' ? (
          <Field label="Source file">
            <input value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="e.g. report.md" />
          </Field>
        ) : (
          <Field label="Text input">
            <textarea style={{ minHeight: '6rem' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. paste a meeting transcript" />
          </Field>
        )}
        <div className="row">
          <button onClick={() => void run()} disabled={busy || !surface}>{busy ? 'Running…' : 'Run surface'}</button>
          {result && <span className="badge">✓ wrote {result.path} v{result.version}</span>}
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <span className="muted">Output lands in the Workspace — open it there to view versions or download.</span>
      </Card>
    </div>
  );
}
