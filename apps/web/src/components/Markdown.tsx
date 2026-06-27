import ReactMarkdown from 'react-markdown';

/**
 * Safe Markdown renderer. react-markdown does NOT use dangerouslySetInnerHTML and does not render
 * raw HTML by default, so untrusted report/document content can't inject markup or scripts.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
