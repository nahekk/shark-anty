'use client';

import { useEffect, useState } from 'react';

type Feed = {
  version: string;
  files: { win: string; mac_arm: string; mac_x64: string; linux: string };
};

type OS = 'win' | 'mac' | 'linux' | null;

const WindowsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 5.1 10.4 4v7.2H3V5.1Zm0 13.8L10.4 20v-7.1H3v6ZM11.3 3.9 21 2.5v8.7h-9.7V3.9Zm0 8.2H21V21.5l-9.7-1.4v-8Z" />
  </svg>
);
const AppleIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.4 1.9c0 1.1-.4 2.1-1.2 3-.9 1-2 1.6-3.1 1.5-.1-1.1.4-2.2 1.2-3C14.1 2.4 15.4 1.8 16.4 1.9Zm3.6 16c-.5 1.3-.8 1.8-1.5 2.9-1 1.6-2.4 3.5-4.1 3.5-1.5 0-1.9-1-4-1-2 0-2.5 1-4 1-1.7 0-3-1.7-4-3.2-2.8-4.3-3.1-9.3-1.4-12 1.2-1.9 3.1-3 4.9-3 1.8 0 2.9 1 4.4 1 1.4 0 2.3-1 4.4-1 1.6 0 3.2.9 4.4 2.3-3.9 2.1-3.2 7.6.5 9.5Z" />
  </svg>
);
const LinuxIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2c-1.9 0-3 1.7-3 3.6 0 1 .1 1.7-.4 2.7-.6 1.1-2.3 2.9-3 4.9-.4 1.1-.3 2 .1 2.4-.2.6-.4 1.3 0 2 .4.6 1.3.7 2 .8.6.1 1.3.6 2 1 .8.4 1.6.4 2.6 0 .7-.4 1.4-.9 2-1 .7-.1 1.6-.2 2-.8.4-.7.2-1.4 0-2 .4-.4.5-1.3.1-2.4-.7-2-2.4-3.8-3-4.9-.5-1-.4-1.7-.4-2.7C15 3.7 13.9 2 12 2Zm-1.3 4.1c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9Zm2.6 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9ZM12 9.2c.8 0 2 .6 2 1.1 0 .3-.6.6-1.1.8-.5.3-.7.5-.9.5s-.4-.2-.9-.5c-.5-.2-1.1-.5-1.1-.8 0-.5 1.2-1.1 2-1.1Z" />
  </svg>
);

const LABELS: Record<Exclude<OS, null>, string> = {
  win: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
};

function detect(): OS {
  if (typeof navigator === 'undefined') return null;
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (s.includes('win')) return 'win';
  if (s.includes('mac') || s.includes('iphone') || s.includes('ipad')) return 'mac';
  if (s.includes('linux') || s.includes('android')) return 'linux';
  return null;
}

// Apple Silicon is a good guess for any recent Mac; keep it the primary Mac option.
const BASE = 'https://sha.best';

export default function Download() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [os, setOs] = useState<OS>(null);

  useEffect(() => {
    setOs(detect());
    fetch('/latest.json')
      .then((r) => r.json())
      .then(setFeed)
      .catch(() => {});
  }, []);

  const href = (f: keyof Feed['files']) => (feed ? `${BASE}/${feed.files[f]}` : '#');
  const ver = feed?.version ? `v${feed.version}` : '';

  const all = [
    { key: 'win' as const, os: 'win' as const, label: 'Windows', note: '.exe installer', Icon: WindowsIcon },
    { key: 'mac_arm' as const, os: 'mac' as const, label: 'Mac · Apple Silicon', note: '.dmg (M1–M4)', Icon: AppleIcon },
    { key: 'mac_x64' as const, os: 'mac' as const, label: 'Mac · Intel', note: '.dmg', Icon: AppleIcon },
    { key: 'linux' as const, os: 'linux' as const, label: 'Linux', note: 'AppImage', Icon: LinuxIcon },
  ];

  // Pick the best primary: Windows default on unknown; Apple Silicon for Mac.
  const primaryOs: Exclude<OS, null> = os ?? 'win';
  const primary =
    primaryOs === 'mac'
      ? all.find((a) => a.key === 'mac_arm')!
      : all.find((a) => a.os === primaryOs) ?? all[0];
  const rest = all.filter((a) => a !== primary);

  const Pi = primary.Icon;

  return (
    <div className="downloads">
      <a className="dl-primary" href={href(primary.key)} download>
        <Pi />
        <span>
          Download for {LABELS[primary.os]}
          {ver ? <span className="sub">&nbsp;&nbsp;{ver} · free</span> : null}
        </span>
      </a>

      <div className="dl-secondary">
        {rest.map((a) => {
          const I = a.Icon;
          return (
            <a className="dl-chip" key={a.key} href={href(a.key)} download>
              <I />
              {a.label}
            </a>
          );
        })}
      </div>

      <div className="dl-note">
        No account, no licence key. Free &amp;{' '}
        <a href="https://github.com/nahekk/shark-anty" target="_blank" rel="noopener noreferrer">
          open-source
        </a>
        .
      </div>
    </div>
  );
}
