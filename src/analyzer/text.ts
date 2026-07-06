const NOISE_TAGS = ['system-reminder', 'command-name', 'command-message', 'command-args', 'local-command-stdout', 'local-command-caveat'];

export function stripInjectedNoise(text: string): string {
  let out = text;
  for (const tag of NOISE_TAGS) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g'), '');
  }
  return out.trim();
}

export function extractMessageText(record: Record<string, unknown>): string | null {
  const message = record['message'] as { content?: unknown } | undefined;
  if (!message || typeof message !== 'object') return null;
  const content = message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  const clean = stripInjectedNoise(text);
  return clean.length > 0 ? clean : null;
}
