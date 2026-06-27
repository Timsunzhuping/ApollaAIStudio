import { useEffect, useState } from 'react';
import { api, type WorkspaceEntry, type WorkspaceFile } from '../lib/api';
import { Card, Field, ErrorMsg, Empty } from '../components/ui';

export function Workspace() {
  const [files, setFiles] = useState<WorkspaceEntry[]>([]);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [history, setHistory] = useState<WorkspaceFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wrPath, setWrPath] = useState('');
  const [wrInstr, setWrInstr] = useState('');

  const loadFiles = () => api.workspace().then(setFiles).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { void loadFiles(); }, []);

  const view = async (path: string, version?: number) => {
    setError(null);
    try {
      const [f, h] = await Promise.all([api.workspaceFile(path, version), api.workspaceHistory(path)]);
      setFile(f);
      setHistory(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load file');
    }
  };

  const rollback = async () => {
    if (!file) return;
    await api.rollback(file.path, file.version);
    await loadFiles();
    await view(file.path);
  };

  const runWriter = async () => {
    if (!wrPath.trim() || !wrInstr.trim()) return;
    try {
      const r = await api.writer(wrPath.trim(), wrInstr.trim());
      await loadFiles();
      await view(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'writer failed');
    }
  };

  return (
    <div className="col">
      <Card title="Writer" actions={<button className="ghost" onClick={() => void loadFiles()}>↻ Files</button>}>
        <div className="row">
          <input placeholder="file path, e.g. report.md" value={wrPath} onChange={(e) => setWrPath(e.target.value)} />
          <input className="grow" placeholder="instruction, e.g. translate the conclusion to English" value={wrInstr} onChange={(e) => setWrInstr(e.target.value)} />
          <button onClick={() => void runWriter()} disabled={!wrPath.trim() || !wrInstr.trim()}>Edit</button>
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Card>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
        <Card title="Files">
          {files.length === 0 ? <Empty>No files yet.</Empty> : files.map((f) => (
            <div key={f.path} className="step">
              <a href="#" onClick={(e) => { e.preventDefault(); void view(f.path); }}>📄 {f.path}</a> <span className="badge">v{f.version}</span>
            </div>
          ))}
        </Card>
        <Card title={file ? `${file.path} · v${file.version}/${history.length}` : 'File'}>
          {!file ? <Empty>Select a file.</Empty> : (
            <div className="col">
              <div className="row">
                <Field label="Version">
                  <select value={file.version} onChange={(e) => void view(file.path, Number(e.target.value))}>
                    {history.map((h) => <option key={h.version} value={h.version}>v{h.version}</option>)}
                  </select>
                </Field>
                <button className="ghost" onClick={() => void rollback()}>⏮ Rollback to this</button>
                <a className="badge" href={api.workspaceDownloadUrl(file.path, file.version)}>⬇ Download</a>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{file.content}</pre>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
