import Download from './download';

export default function Home() {
  return (
    <>
      <div className="bg" />
      <div className="grid-overlay" />

      <main className="hero">
        <div className="wrap">
          <div className="brand hero-brand">
            <img src="/logo.png" alt="" />
            Shark<span className="brace">{'{'}</span>anty<span className="brace">{'}'}</span>
          </div>

          <h1>
            Freedom should<br />be <span className="accent">free.</span>
          </h1>
          <p className="attrib">— <b>Shark{'{'}anty{'}'}</b></p>

          <p className="lede">
            Unlimited browser profiles on the newest Chromium, each with its own proxy,
            cookies and editable fingerprint. No account, no limits, no telemetry.
          </p>

          <Download />
        </div>
      </main>
    </>
  );
}
