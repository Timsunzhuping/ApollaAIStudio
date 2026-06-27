import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, Field } from '../components/ui';

export function Settings() {
  const [language, setLanguage] = useState('');
  const [style, setStyle] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.getMemoryModel().then((m) => {
      setLanguage(String((m as { language?: string }).language ?? ''));
      setStyle(String((m as { style?: string }).style ?? ''));
    }).catch(() => {});
  }, []);

  const save = async () => {
    await api.setMemoryModel({ language, style });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="col">
      <Card title="Writing preferences">
        <span className="muted">Future research and drafts reflect these.</span>
        <Field label="Preferred language"><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English, Chinese" /></Field>
        <Field label="Preferred style"><input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. concise bullets" /></Field>
        <div className="row">
          <button onClick={() => void save()}>Save preferences</button>
          {saved && <span className="badge">✓ saved</span>}
        </div>
      </Card>
      <Card title="Memory">
        <span className="muted">Clear all remembered notes for your account.</span>
        <div><button className="ghost" onClick={() => void api.clearMemory()}>Clear memory</button></div>
      </Card>
    </div>
  );
}
