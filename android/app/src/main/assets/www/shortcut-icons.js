// Original line drawings approved in the Federano shortcut preview; these are not official logos.
// Data only: no command inference, network requests, or executable actions.
export const SHORTCUT_APPS = [
    { id: 'spotify', label: 'Spotify', group: 'Mídia', color: '#1ed760', keywords: ['música', 'audio', 'podcast'], paths: '<circle cx="12" cy="12" r="9"/><path d="M6.8 9.3c3.7-1.2 7.5-.8 10.6 1M7.5 12.4c3-1 6.1-.7 8.8.8M8.2 15.3c2.4-.7 4.7-.4 6.8.7"/>' },
    { id: 'youtube', label: 'YouTube', group: 'Mídia', color: '#ff4848', keywords: ['vídeo', 'video', 'música'], paths: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9 5 3-5 3z"/>' },
    { id: 'chrome', label: 'Chrome', group: 'Navegação', color: '#79a9ff', keywords: ['google', 'navegador', 'browser'], paths: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5h8M9 13.8 5 7M14 14.8l-4 6"/>' },
    { id: 'edge', label: 'Microsoft Edge', group: 'Navegação', color: '#49c6df', keywords: ['navegador', 'browser', 'internet'], paths: '<path d="M21 13a9 9 0 0 0-17.6-2.6C5.1 7.7 9.4 7 12.5 8.8c3.6 2.1 3.4 5.7-.2 6.3-2.8.5-4.7-1.5-4.6-3.3-2.6 1.5-3 4.3-1.3 6.5 2.6 3.4 9.8 3.2 12.7-.3-3.4 1.8-8.2 1.5-9.9-1.3"/>' },
    { id: 'whatsapp', label: 'WhatsApp', group: 'Comunicação', color: '#49d886', keywords: ['mensagem', 'chat', 'telefone'], paths: '<path d="M5.2 18.5 3 21l.9-5A9 9 0 1 1 12 21c-2.5 0-4.9-.9-6.8-2.5Z"/><path d="m8 7 1.8 2.7-1 1.3c.9 1.8 2.2 3 4 3.9l1.2-1 2.8 1.6c-.3 1.3-1 2-2.2 1.9-3.3-.3-7.7-4.8-8-8.1C6.5 8.1 7 7.4 8 7Z"/>' },
    { id: 'telegram', label: 'Telegram', group: 'Comunicação', color: '#67bdf2', keywords: ['mensagem', 'chat', 'avião'], paths: '<path d="m3 10 18-7-4 18-5-6-4 3 1-7 8-5-6 7-3-2Z"/>' },
    { id: 'discord', label: 'Discord', group: 'Comunicação', color: '#a1a8ff', keywords: ['chat', 'voz', 'comunidade'], paths: '<path d="M7 5.5 10 5l.5 1h3L14 5l3 .5c2.5 3 3.7 6.8 3.5 10.5L17 18l-1.5-2c-2.2.8-4.8.8-7 0L7 18l-3.5-2C3.3 12.3 4.5 8.5 7 5.5Z"/><path d="M7.5 8.5c2.5-1 6.5-1 9 0M8 14.5c2.5 1 5.5 1 8 0"/><circle cx="8.5" cy="11.5" r=".8"/><circle cx="15.5" cy="11.5" r=".8"/>' },
    { id: 'meet', label: 'Google Meet', group: 'Comunicação', color: '#68d49b', keywords: ['reunião', 'reuniões', 'videochamada'], paths: '<rect x="3" y="5.5" width="12" height="13" rx="2"/><path d="m15 9 6-4v14l-6-4M3 9h4V5.5M3 15h4v3.5"/>' },
    { id: 'calendar', label: 'Google Agenda', group: 'Criação e trabalho', color: '#80adff', keywords: ['calendário', 'compromissos', 'reunião'], paths: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 13h3l-2 2 2 1.5-1 1.5H8M14 14l2-1v5"/>' },
    { id: 'gmail', label: 'Gmail', group: 'Comunicação', color: '#f0837f', keywords: ['email', 'e-mail', 'correio', 'google'], paths: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7M3 5l9 7 9-7"/>' },
    { id: 'outlook', label: 'Outlook', group: 'Comunicação', color: '#69b6fa', keywords: ['email', 'e-mail', 'correio', 'microsoft'], paths: '<path d="M11 5h8a2 2 0 0 1 2 2v12H11M11 9h10m-10 3 4 3 6-5"/><rect x="2.5" y="7" width="10" height="12" rx="1"/><ellipse cx="7.5" cy="13" rx="2.2" ry="3"/>' },
    { id: 'teams', label: 'Microsoft Teams', group: 'Comunicação', color: '#aaa1ed', keywords: ['chat', 'reunião', 'trabalho'], paths: '<circle cx="13.5" cy="5.5" r="2"/><circle cx="19.5" cy="7.5" r="1.5"/><path d="M18 11h3v4a3 3 0 0 1-3 3M11 10h6v6a4 4 0 0 1-6.5 3"/><rect x="2.5" y="8.5" width="10" height="11" rx="1.5"/><path d="M5 12h5M7.5 12v5"/>' },
    { id: 'vscode', label: 'Visual Studio Code', group: 'Criação e trabalho', color: '#71bcf2', keywords: ['código', 'editor', 'programação', 'code'], paths: '<path d="m16.5 3 5 2v14l-5 2L7 13l-4 3-1-1V9l1-1 4 3 9.5-8ZM16.5 7 10 12l6.5 5ZM16.5 3v18"/>' },
    { id: 'github', label: 'GitHub', group: 'Criação e trabalho', color: '#c9c5d5', keywords: ['git', 'código', 'repositorio', 'repositório'], paths: '<path d="M8 20.5v-3c-3.7-.6-5-2.8-5-5.7 0-1.6.6-2.8 1.7-3.9-.3-1.1-.2-2.4.2-3.4 1.6 0 2.8.6 3.7 1.3 2.2-.5 4.6-.5 6.8 0 .9-.7 2.1-1.3 3.7-1.3.4 1 .5 2.3.2 3.4 1.1 1.1 1.7 2.3 1.7 3.9 0 2.9-1.3 5.1-5 5.7v3M8 18c-4.5 1-3.8-3-6-3M10 16.5h4"/>' },
    { id: 'terminal', label: 'Terminal', group: 'Criação e trabalho', color: '#b9c3d0', keywords: ['powershell', 'cmd', 'console', 'comando'], paths: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m6 9 3 3-3 3M12 15h5"/>' },
    { id: 'explorer', label: 'Explorador de Arquivos', group: 'Navegação', color: '#efc96e', keywords: ['pasta', 'arquivos', 'windows', 'explorer'], paths: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 10h18"/>' },
    { id: 'notion', label: 'Notion', group: 'Criação e trabalho', color: '#d0cbd1', keywords: ['notas', 'documentos', 'organização'], paths: '<path d="m4 4 13-1 3 3v14L7 21l-3-3V4ZM4 4l3 3 13-1M7 7v14M10 17V10l6 7v-7"/>' },
    { id: 'obs', label: 'OBS Studio', group: 'Criação e trabalho', color: '#c8c4d1', keywords: ['gravação', 'stream', 'streaming', 'live'], paths: '<circle cx="12" cy="12" r="9"/><path d="M12 12c-1-4 2-7 5-5M12 12c4 1 5 5 2 7M12 12c-3 3-7 2-7-1M12 12c-3-1-4-4-2-6M12 12c2-2 5-1 6 1M12 12c1 3-1 5-3 5"/>' },
    { id: 'vlc', label: 'VLC', group: 'Mídia', color: '#efa669', keywords: ['vídeo', 'video', 'player', 'filme'], paths: '<path d="m11 3-7 17h16L13 3ZM7.7 11h8.6M5.6 16h12.8M3 21h18M9.7 6h4.6"/>' },
    { id: 'steam', label: 'Steam', group: 'Mídia', color: '#a2c9ee', keywords: ['jogos', 'games', 'gaming'], paths: '<circle cx="15.7" cy="7.8" r="4.2"/><circle cx="15.7" cy="7.8" r="2.1"/><circle cx="7" cy="16.5" r="3"/><path d="m9 14.2 3.4-3.6M10 16l5.1-4.1M4.3 15.3 2 14l-.5 3 3.4 2M6 15.7l2.2 1.1"/>' },
    { id: 'word', label: 'Word', group: 'Criação e trabalho', color: '#79a9f2', keywords: ['documento', 'texto', 'office', 'microsoft'], paths: '<path d="M10 3h9l2 2v16H10M17 3v4h4M14 10h4M14 13h4M14 16h4"/><rect x="2.5" y="7" width="11" height="12" rx="1"/><path d="m4.5 10 1.4 6 2.1-4 2.1 4 1.4-6"/>' },
    { id: 'excel', label: 'Excel', group: 'Criação e trabalho', color: '#72d19b', keywords: ['planilha', 'office', 'microsoft', 'tabela'], paths: '<path d="M10 3h11v18H10M14 7h7M14 11h7M14 15h7M17 3v18"/><rect x="2.5" y="7" width="11" height="12" rx="1"/><path d="m5.5 10 5 6m0-6-5 6"/>' },
    { id: 'powerpoint', label: 'PowerPoint', group: 'Criação e trabalho', color: '#eb9c80', keywords: ['slides', 'apresentação', 'office', 'microsoft'], paths: '<path d="M10 3h11v18H10M16 7v5h5M16 7a5 5 0 0 0 0 10 5 5 0 0 0 5-5"/><rect x="2.5" y="7" width="11" height="12" rx="1"/><path d="M6 16v-6h2a2 2 0 0 1 0 4H6"/>' },
    { id: 'chatgpt', label: 'ChatGPT', group: 'Criação e trabalho', color: '#8ad1be', keywords: ['ia', 'ai', 'openai', 'assistente', 'codex'], paths: '<path d="M12 4c3-3 8 1 6 5 4 1 3 7-1 8 0 4-6 6-8 2-4 1-7-4-4-7C1 9 5 4 8 5c0-3 2-3 4-1Z"/><path d="m8 5 7 4v6l-6 4M18 9l-7 4-6-1M17 17l-6-4V6M9 19v-7l6-3"/>' },
    { id: 'claude', label: 'Claude', group: 'Criação e trabalho', color: '#dda387', keywords: ['ia', 'ai', 'anthropic', 'assistente'], paths: '<path d="m12 3 .5 6 4-5-2 6 6-2-5 4 6 .5-6 1 4.5 4-6-2 1 6-3-5-2 5-.5-6-4 4 2-6-6 1 5-3-5-2 6 .5-3.5-5 5 3Z"/>' },
  ].map((app) => Object.freeze({ ...app, keywords: Object.freeze(app.keywords) }));

const byId = new Map(SHORTCUT_APPS.map((app) => [app.id, app]));
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map();
for (const app of SHORTCUT_APPS) for (const name of [app.id, app.label]) aliases.set(normalize(name), app.id);
for (const [name, id] of Object.entries({ code: 'vscode', files: 'explorer', fileexplorer: 'explorer', explorador: 'explorer',
  googlechrome: 'chrome', microsoftteams: 'teams', googlecalendar: 'calendar', calendariogoogle: 'calendar',
  microsoftword: 'word', microsoftexcel: 'excel', microsoftpowerpoint: 'powerpoint', windowsTerminal: 'terminal' })) aliases.set(normalize(name), id);
const genericIcons = new Set(['', '•', '⚡', '🔘']);
const defaults = { terminal: ['⌨️', '⌨', '💻'], explorer: ['📁', '📂'], vscode: ['📝', '💻'], spotify: ['🎧', '🎵'],
  youtube: ['▶️', '🎬'], whatsapp: ['💬'], discord: ['💬'], telegram: ['💬'], meet: ['📹'], calendar: ['📅'],
  gmail: ['✉️', '📧'], outlook: ['✉️', '📧'], teams: ['💬'], github: ['🐙'], notion: ['📝'], obs: ['📹'],
  vlc: ['🎬'], steam: ['🎮'], word: ['📝'], excel: ['📊'], powerpoint: ['📊'], chatgpt: ['🤖'], claude: ['🤖'],
  chrome: ['🌐'], edge: ['🌐'] };

/** Explicit app:id is always available. Automatic matches use only names and default icons, never commands. */
export function shortcutAppIcon(shortcut) {
  if (!shortcut || shortcut.iconUpload === true) return null;
  const raw = String(shortcut.icon || '').trim();
  const explicit = /^app:([a-z0-9-]+)$/.exec(raw);
  if (explicit) return byId.get(explicit[1]) || null;
  const id = aliases.get(normalize(shortcut.label)) || aliases.get(normalize(shortcut.id));
  if (!id || (!genericIcons.has(raw) && !(defaults[id] || []).includes(raw))) return null;
  return byId.get(id) || null;
}

export function shortcutIconSvg(app) {
  if (!app || byId.get(app.id) !== app) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${app.paths}</svg>`;
}

